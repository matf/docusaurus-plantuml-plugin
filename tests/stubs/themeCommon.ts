import {stubState} from './state.js';

export function useColorMode(): {colorMode: 'light' | 'dark'; setColorMode: () => void} {
  return {
    colorMode: stubState.colorMode,
    setColorMode: () => {
      /* not needed by these tests */
    },
  };
}
