import {describe, expect, it, vi} from 'vitest';

import {
  computeCacheKey,
  computeGraphvizCacheKey,
  createDiagramCache,
  getSharedCache,
  resetSharedCaches,
} from '../../src/runtime/cache.js';

const SOURCE = '@startuml\nAlice -> Bob\n@enduml';
const BASE = {
  source: SOURCE,
  dark: false,
  sanitized: true,
  coreVersion: '1.2026.6',
  stdlibRevision: 'abc123' as string | null,
};

describe('cache keys', () => {
  it('is deterministic for identical input', () => {
    expect(computeCacheKey(BASE)).toBe(computeCacheKey({...BASE}));
  });

  it('separates light and dark renders of the same source', () => {
    expect(computeCacheKey({...BASE, dark: true})).not.toBe(
      computeCacheKey({...BASE, dark: false}),
    );
  });

  it('separates sanitized and unsanitized output', () => {
    expect(computeCacheKey({...BASE, sanitized: false})).not.toBe(computeCacheKey(BASE));
  });

  it('changes when the engine version changes', () => {
    expect(computeCacheKey({...BASE, coreVersion: '1.2027.0'})).not.toBe(computeCacheKey(BASE));
  });

  it('changes when the diagram source changes', () => {
    expect(computeCacheKey({...BASE, source: '@startuml\nAlice -> Carol\n@enduml'})).not.toBe(
      computeCacheKey(BASE),
    );
  });

  it('changes when the standard library changes', () => {
    expect(computeCacheKey({...BASE, stdlibRevision: 'def456'})).not.toBe(computeCacheKey(BASE));
  });

  it('separates renders made with and without the standard library', () => {
    expect(computeCacheKey({...BASE, stdlibRevision: null})).not.toBe(computeCacheKey(BASE));
  });

  it('encodes the colour mode and engine version legibly', () => {
    expect(computeCacheKey({...BASE, dark: true})).toMatch(/^1\.2026\.6\|abc123\|dark\|san\|/);
  });
});

describe('memory cache', () => {
  it('stores and returns rendered SVG', () => {
    const cache = createDiagramCache('memory', 10);
    cache.set('a', '<svg id="a"/>');
    expect(cache.get('a')).toBe('<svg id="a"/>');
    expect(cache.size()).toBe(1);
  });

  it('returns undefined for an unknown key', () => {
    expect(createDiagramCache('memory', 10).get('missing')).toBeUndefined();
  });

  it('evicts least-recently-used entries beyond the documented limit', () => {
    const cache = createDiagramCache('memory', 3);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Touching 'a' makes 'b' the least recently used.
    expect(cache.get('a')).toBe('1');
    cache.set('d', '4');

    expect(cache.size()).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
  });

  it('does not grow when the same key is written repeatedly', () => {
    const cache = createDiagramCache('memory', 5);
    for (let index = 0; index < 20; index += 1) cache.set('same', `v${index}`);
    expect(cache.size()).toBe(1);
    expect(cache.get('same')).toBe('v19');
  });

  it('separates light and dark entries in practice', () => {
    const cache = createDiagramCache('memory', 10);
    const light = computeCacheKey({...BASE, dark: false});
    const dark = computeCacheKey({...BASE, dark: true});

    cache.set(light, '<svg data-mode="light"/>');
    cache.set(dark, '<svg data-mode="dark"/>');

    expect(cache.get(light)).toContain('light');
    expect(cache.get(dark)).toContain('dark');
  });
});

describe('none cache', () => {
  it('never stores anything', () => {
    const cache = createDiagramCache('none', 10);
    cache.set('a', '<svg/>');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

describe('session cache', () => {
  it('persists entries in sessionStorage under a namespaced key', () => {
    const cache = createDiagramCache('session', 10);
    cache.set('abc', '<svg id="x"/>');

    expect(cache.get('abc')).toBe('<svg id="x"/>');
    const stored = window.sessionStorage.getItem('plantuml-client:abc');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({v: 1, svg: '<svg id="x"/>'});
  });

  it('ignores a corrupt value instead of failing the render', () => {
    window.sessionStorage.setItem('plantuml-client:broken', 'not json at all');
    const cache = createDiagramCache('session', 10);

    expect(cache.get('broken')).toBeUndefined();
    // The unusable entry is dropped rather than left to fail again.
    expect(window.sessionStorage.getItem('plantuml-client:broken')).toBeNull();
  });

  it('ignores a stored entry written by an incompatible version', () => {
    window.sessionStorage.setItem('plantuml-client:old', JSON.stringify({v: 99, svg: '<svg/>'}));
    expect(createDiagramCache('session', 10).get('old')).toBeUndefined();
  });

  it('ignores a stored entry whose payload is the wrong shape', () => {
    window.sessionStorage.setItem('plantuml-client:odd', JSON.stringify({v: 1, svg: 42}));
    expect(createDiagramCache('session', 10).get('odd')).toBeUndefined();
  });

  it('keeps rendering when sessionStorage.setItem throws (quota or private mode)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const cache = createDiagramCache('session', 10);
    expect(() => cache.set('a', '<svg/>')).not.toThrow();

    setItem.mockRestore();
    // The value survives in the in-memory fallback, so the diagram is not re-rendered.
    expect(cache.get('a')).toBe('<svg/>');
  });

  it('keeps rendering when sessionStorage.getItem throws', () => {
    const cache = createDiagramCache('session', 10);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => cache.get('a')).not.toThrow();
    expect(cache.get('a')).toBeUndefined();
    getItem.mockRestore();
  });

  it('trims its own namespace to the documented limit', () => {
    const cache = createDiagramCache('session', 3);
    window.sessionStorage.setItem('unrelated-key', 'keep me');

    for (const key of ['a', 'b', 'c', 'd', 'e']) cache.set(key, `<svg id="${key}"/>`);

    expect(cache.size()).toBeLessThanOrEqual(3);
    expect(window.sessionStorage.getItem('unrelated-key')).toBe('keep me');
    expect(cache.get('e')).toBe('<svg id="e"/>');
  });

  it('clears only its own keys', () => {
    const cache = createDiagramCache('session', 10);
    cache.set('a', '<svg/>');
    window.sessionStorage.setItem('someone-else', 'value');

    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(window.sessionStorage.getItem('someone-else')).toBe('value');
  });
});

describe('shared caches', () => {
  it('returns one instance per mode and limit so diagrams share results', () => {
    expect(getSharedCache('memory', 50)).toBe(getSharedCache('memory', 50));
    expect(getSharedCache('memory', 50)).not.toBe(getSharedCache('memory', 10));
    expect(getSharedCache('memory', 50)).not.toBe(getSharedCache('session', 50));
  });

  it('is emptied by resetSharedCaches', () => {
    getSharedCache('memory', 50).set('a', '<svg/>');
    resetSharedCaches();
    expect(getSharedCache('memory', 50).get('a')).toBeUndefined();
  });
});

describe('graphviz cache keys', () => {
  const base = {
    source: 'digraph {a -> b}',
    layout: 'dot',
    sanitized: true,
    transparentBackground: true,
    coreVersion: '1.2026.6',
  };

  it('is stable for identical input', () => {
    expect(computeGraphvizCacheKey(base)).toBe(computeGraphvizCacheKey({...base}));
  });

  it('ignores the colour mode entirely', () => {
    // Graphviz output adapts through CSS instead of being re-rendered, so one entry serves
    // both colour modes. There is deliberately no `dark` field to vary.
    expect(computeGraphvizCacheKey(base)).not.toMatch(/dark|light/);
  });

  it('separates the two layout engines', () => {
    expect(computeGraphvizCacheKey({...base, layout: 'neato'})).not.toBe(
      computeGraphvizCacheKey(base),
    );
  });

  it('separates the two background settings', () => {
    expect(computeGraphvizCacheKey({...base, transparentBackground: false})).not.toBe(
      computeGraphvizCacheKey(base),
    );
  });

  it('separates sanitized from raw output', () => {
    expect(computeGraphvizCacheKey({...base, sanitized: false})).not.toBe(
      computeGraphvizCacheKey(base),
    );
  });

  it('invalidates every entry when the engine version changes', () => {
    expect(computeGraphvizCacheKey({...base, coreVersion: '1.2027.1'})).not.toBe(
      computeGraphvizCacheKey(base),
    );
  });

  it('separates two different sources', () => {
    expect(computeGraphvizCacheKey({...base, source: 'digraph {a -> c}'})).not.toBe(
      computeGraphvizCacheKey(base),
    );
  });

  it('cannot collide with a PlantUML key for the same source', () => {
    const plantuml = computeCacheKey({
      source: base.source,
      dark: false,
      sanitized: true,
      coreVersion: base.coreVersion,
      stdlibRevision: null,
    });
    expect(computeGraphvizCacheKey(base)).not.toBe(plantuml);
    expect(computeGraphvizCacheKey(base).startsWith('graphviz|')).toBe(true);
  });

  it('carries the source length alongside the hash', () => {
    expect(computeGraphvizCacheKey(base)).toContain(`|${base.source.length}|`);
  });
});
