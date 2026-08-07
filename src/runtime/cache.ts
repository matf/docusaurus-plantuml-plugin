import type {CacheMode} from '../options.js';

/**
 * Rendered SVG is cached under a key that folds in everything that can change the output.
 * Colour mode is part of the key, so toggling dark mode can never serve the other mode's
 * picture, and the `@plantuml/core` version is part of it so an engine upgrade invalidates
 * every stored entry.
 */

const STORAGE_PREFIX = 'plantuml-client:';
const ENTRY_VERSION = 1;

export interface CacheKeyInput {
  source: string;
  dark: boolean;
  sanitized: boolean;
  coreVersion: string;
}

export interface DiagramCache {
  readonly mode: CacheMode;
  get(key: string): string | undefined;
  set(key: string, svg: string): void;
  clear(): void;
  /** Number of entries currently held. Exposed for tests and the documented size limit. */
  size(): number;
}

interface StoredEntry {
  v: number;
  svg: string;
}

/** FNV-1a. Not cryptographic — this only needs to be fast, stable and short. */
function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36).padStart(7, '0');
}

export function computeCacheKey({source, dark, sanitized, coreVersion}: CacheKeyInput): string {
  const mode = dark ? 'dark' : 'light';
  const clean = sanitized ? 'san' : 'raw';
  // The length guards against the (astronomically unlikely) 32-bit hash collision between
  // two different sources that happen to share every other key component.
  return `${coreVersion}|${mode}|${clean}|${source.length}|${hash(source)}`;
}

export interface GraphvizCacheKeyInput {
  source: string;
  /** Graphviz layout engine; `dot` and `neato` draw different pictures from one source. */
  layout: string;
  sanitized: boolean;
  transparentBackground: boolean;
  /**
   * `@plantuml/core` version. The Graphviz build is bundled inside that package, so its
   * version is what changes when the engine changes — and unlike `Viz.graphvizVersion` it is
   * known before the engine has loaded, which is what lets a cache hit skip loading entirely.
   */
  coreVersion: string;
}

/**
 * Cache key for a Graphviz diagram.
 *
 * The colour mode is deliberately **absent**: Graphviz output is colour-mode independent and
 * adapts through CSS rather than through a re-render, so one entry serves both modes. The
 * `graphviz|` prefix keeps these entries in a separate namespace from PlantUML's.
 */
export function computeGraphvizCacheKey({
  source,
  layout,
  sanitized,
  transparentBackground,
  coreVersion,
}: GraphvizCacheKeyInput): string {
  const clean = sanitized ? 'san' : 'raw';
  const background = transparentBackground ? 'bg-none' : 'bg-default';
  return `graphviz|${coreVersion}|${layout}|${background}|${clean}|${source.length}|${hash(source)}`;
}

class MemoryCache implements DiagramCache {
  readonly mode: CacheMode = 'memory';
  readonly #entries = new Map<string, string>();
  readonly #maxEntries: number;

  constructor(maxEntries: number) {
    this.#maxEntries = maxEntries;
  }

  get(key: string): string | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    // Re-insert so the Map's insertion order doubles as LRU recency.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, svg: string): void {
    this.#entries.delete(key);
    this.#entries.set(key, svg);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  size(): number {
    return this.#entries.size;
  }
}

class NoopCache implements DiagramCache {
  readonly mode: CacheMode = 'none';
  get(): undefined {
    return undefined;
  }
  set(): void {
    /* intentionally not stored */
  }
  clear(): void {
    /* nothing to clear */
  }
  size(): number {
    return 0;
  }
}

/**
 * `sessionStorage` is best-effort by design: it is unavailable in private modes and some
 * embedded browsers, it throws on quota exhaustion, and its contents can be edited by hand.
 * Every access is therefore guarded, and a bad read is discarded rather than propagated.
 */
class SessionCache implements DiagramCache {
  readonly mode: CacheMode = 'session';
  readonly #maxEntries: number;
  readonly #fallback: MemoryCache;

  constructor(maxEntries: number) {
    this.#maxEntries = maxEntries;
    this.#fallback = new MemoryCache(maxEntries);
  }

  #storage(): Storage | null {
    try {
      const storage = globalThis.sessionStorage;
      return storage ?? null;
    } catch {
      return null;
    }
  }

  get(key: string): string | undefined {
    const storage = this.#storage();
    if (!storage) return this.#fallback.get(key);
    let raw: string | null;
    try {
      raw = storage.getItem(STORAGE_PREFIX + key);
    } catch {
      return this.#fallback.get(key);
    }
    // A miss in storage still has to consult the fallback: entries written while storage was
    // rejecting writes (quota, private mode) live only there.
    if (raw === null) return this.#fallback.get(key);
    try {
      const parsed = JSON.parse(raw) as StoredEntry;
      if (parsed?.v !== ENTRY_VERSION || typeof parsed.svg !== 'string') {
        this.#drop(storage, key);
        return this.#fallback.get(key);
      }
      return parsed.svg;
    } catch {
      this.#drop(storage, key);
      return this.#fallback.get(key);
    }
  }

  set(key: string, svg: string): void {
    const storage = this.#storage();
    if (!storage) {
      this.#fallback.set(key, svg);
      return;
    }
    const entry: StoredEntry = {v: ENTRY_VERSION, svg};
    try {
      this.#evictIfNeeded(storage);
      storage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Quota exceeded or storage disabled mid-session: keep rendering, just stop persisting.
      this.#fallback.set(key, svg);
    }
  }

  #ownKeys(storage: Storage): string[] {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    return keys;
  }

  #evictIfNeeded(storage: Storage): void {
    const keys = this.#ownKeys(storage);
    // `sessionStorage` has no recency information, so this is a plain FIFO trim of our own
    // namespace. The documented bound is what matters; exact eviction order is not.
    for (let index = 0; index <= keys.length - this.#maxEntries; index += 1) {
      const key = keys[index];
      if (key !== undefined) storage.removeItem(key);
    }
  }

  #drop(storage: Storage, key: string): void {
    try {
      storage.removeItem(STORAGE_PREFIX + key);
    } catch {
      /* nothing more we can do */
    }
  }

  clear(): void {
    this.#fallback.clear();
    const storage = this.#storage();
    if (!storage) return;
    try {
      this.#ownKeys(storage).forEach((key) => storage.removeItem(key));
    } catch {
      /* nothing more we can do */
    }
  }

  size(): number {
    const storage = this.#storage();
    if (!storage) return this.#fallback.size();
    try {
      return this.#ownKeys(storage).length;
    } catch {
      return this.#fallback.size();
    }
  }
}

export function createDiagramCache(mode: CacheMode, maxEntries: number): DiagramCache {
  switch (mode) {
    case 'none':
      return new NoopCache();
    case 'session':
      return new SessionCache(maxEntries);
    case 'memory':
    default:
      return new MemoryCache(maxEntries);
  }
}

/**
 * One cache per (mode, limit) pair, shared by every diagram on the page so that the same
 * source rendered twice is only rendered once.
 */
const sharedCaches = new Map<string, DiagramCache>();

export function getSharedCache(mode: CacheMode, maxEntries: number): DiagramCache {
  const key = `${mode}:${maxEntries}`;
  let cache = sharedCaches.get(key);
  if (!cache) {
    cache = createDiagramCache(mode, maxEntries);
    sharedCaches.set(key, cache);
  }
  return cache;
}

/** Test-only: drops every shared cache instance. */
export function resetSharedCaches(): void {
  sharedCaches.forEach((cache) => cache.clear());
  sharedCaches.clear();
}
