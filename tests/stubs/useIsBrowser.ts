import {stubState} from './state.js';

export default function useIsBrowser(): boolean {
  return stubState.isBrowser;
}
