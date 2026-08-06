import {stubState} from './state.js';

export function useAllPluginInstancesData(
  pluginName: string,
  options: {failfast?: boolean} = {},
): Record<string, unknown> | undefined {
  const data = stubState.globalData?.[pluginName];
  if (!data && options.failfast) {
    throw new Error(`Docusaurus plugin global data not found for "${pluginName}" plugin.`);
  }
  return data;
}

export function usePluginData(pluginName: string, pluginId = 'default'): unknown {
  return stubState.globalData?.[pluginName]?.[pluginId];
}

export default function useGlobalData(): Record<string, Record<string, unknown>> {
  return stubState.globalData ?? {};
}
