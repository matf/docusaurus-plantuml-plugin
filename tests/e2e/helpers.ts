import type {ConsoleMessage, Page, Request} from '@playwright/test';

/** Requests that reveal a third-party rendering service or CDN sneaking in. */
const FORBIDDEN_HOST_PATTERN =
  /plantuml\.com|kroki\.io|unpkg\.com|jsdelivr\.net|cdnjs|googleapis\.com|gstatic\.com/i;

/** Console noise that says the page is genuinely broken. */
const REAL_ERROR_PATTERN =
  /hydrat|did not match|Minified React error|Warning: .*server|Uncaught|is not a function|Failed to fetch/i;

export interface PageMonitor {
  consoleErrors: string[];
  pageErrors: string[];
  requests: string[];
  runtimeRequests: string[];
  externalRequests: string[];
  forbiddenRequests: string[];
  hydrationWarnings: string[];
}

/**
 * Records everything the browser did, so a test can assert on network and console activity
 * that happened *before* its assertions ran.
 *
 * Attach this before the first `page.goto`.
 */
export function monitor(page: Page, origin: string): PageMonitor {
  const state: PageMonitor = {
    consoleErrors: [],
    pageErrors: [],
    requests: [],
    runtimeRequests: [],
    externalRequests: [],
    forbiddenRequests: [],
    hydrationWarnings: [],
  };

  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (message.type() === 'error') state.consoleErrors.push(text);
    if (REAL_ERROR_PATTERN.test(text)) state.hydrationWarnings.push(text);
  });

  page.on('pageerror', (error) => state.pageErrors.push(error.message));

  page.on('request', (request: Request) => {
    const url = request.url();
    state.requests.push(url);
    if (isRuntimeAsset(url)) state.runtimeRequests.push(url);
    if (FORBIDDEN_HOST_PATTERN.test(url)) state.forbiddenRequests.push(url);
    if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) state.externalRequests.push(url);
  });

  return state;
}

export function isRuntimeAsset(url: string): boolean {
  return /\/(viz-global|plantuml)\.js(\?|$)/.test(url);
}

export function countRequests(urls: string[], filename: string): number {
  return urls.filter((url) => url.includes(`/${filename}`)).length;
}

/** The `data-plantuml-status` values that mean the component has stopped working. */
export const TERMINAL_STATUSES = ['ready', 'error'];

export async function waitForDiagrams(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[data-plantuml-status="ready"],[data-plantuml-status="error"]')
        .length >= count,
    expected,
    {timeout: 90_000},
  );
}
