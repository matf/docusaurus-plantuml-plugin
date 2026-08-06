import {DEFAULT_OPTIONS, type ResolvedPlantUmlOptions} from '../../src/options.js';
import {PLUGIN_NAME} from '../../src/constants.js';

/**
 * Mutable stand-in for the Docusaurus context that theme components read from.
 *
 * Tests set these values instead of booting a Docusaurus site.
 */
export interface StubState {
  colorMode: 'light' | 'dark';
  baseUrl: string;
  globalData: Record<string, Record<string, unknown>> | undefined;
  isBrowser: boolean;
}

const CORE_VERSION = '1.2026.6';

function defaultGlobalData(options: ResolvedPlantUmlOptions) {
  return {
    [PLUGIN_NAME]: {
      default: {
        options,
        assetsDir: `assets/plantuml-client-${CORE_VERSION}`,
        coreVersion: CORE_VERSION,
      },
    },
  };
}

export const stubState: StubState = {
  colorMode: 'light',
  baseUrl: '/plantuml-test/',
  globalData: defaultGlobalData(DEFAULT_OPTIONS),
  isBrowser: true,
};

export function resetStubs(): void {
  stubState.colorMode = 'light';
  stubState.baseUrl = '/plantuml-test/';
  stubState.globalData = defaultGlobalData(DEFAULT_OPTIONS);
  stubState.isBrowser = true;
}

/** Replaces the plugin options exposed through global data. */
export function setStubOptions(overrides: Partial<ResolvedPlantUmlOptions>): void {
  stubState.globalData = defaultGlobalData({...DEFAULT_OPTIONS, ...overrides});
}

/** Simulates a site where the plugin was never registered. */
export function removeStubGlobalData(): void {
  stubState.globalData = {};
}

export const STUB_CORE_VERSION = CORE_VERSION;
