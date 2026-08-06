import '@testing-library/jest-dom/vitest';

import {afterEach, beforeEach} from 'vitest';
import {cleanup} from '@testing-library/react';

import {resetRuntimeLoader} from '../src/runtime/assetLoader.js';
import {resetSharedCaches} from '../src/runtime/cache.js';
import {resetRenderQueue} from '../src/runtime/queue.js';
import {resetSanitizer} from '../src/runtime/sanitize.js';
import {resetStubs} from './stubs/state.js';

/**
 * Every module-level singleton is reset between tests. Without this, test order would
 * determine outcomes — the loader would stay resolved, the queue would stay occupied, and
 * caches would leak rendered SVG from one case into the next.
 */
// The SSR suite runs in the `node` environment, where none of the browser globals exist.
const isBrowserLike = typeof window !== 'undefined';

beforeEach(() => {
  resetRuntimeLoader();
  resetRenderQueue();
  resetSharedCaches();
  resetSanitizer();
  resetStubs();
  if (isBrowserLike) window.sessionStorage.clear();
});

afterEach(() => {
  if (isBrowserLike) cleanup();
  resetRuntimeLoader();
  resetRenderQueue();
  resetSharedCaches();
});
