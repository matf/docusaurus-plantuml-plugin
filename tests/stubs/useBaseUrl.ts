import {stubState} from './state.js';

/** Mirrors Docusaurus' `useBaseUrl`: prefixes a site-relative path with `baseUrl`. */
export default function useBaseUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = stubState.baseUrl.endsWith('/') ? stubState.baseUrl : `${stubState.baseUrl}/`;
  return `${base}${url.replace(/^\//, '')}`;
}
