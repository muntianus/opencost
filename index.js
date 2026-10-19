/**
 * PerfOps OpenCost SDK & Container Cost Allocation Entrypoint
 */

export {
  DEFAULT_RATES,
  DEFAULT_WINDOW,
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  WINDOW_HOURS_MAP,
  WINDOW_UNIT_HOURS,
  WindowValidationError,
  ESTATE_CONTAINERS,
  parseWindow,
  parseWindowHours,
  allocateSingleContainer,
  computeAllocationReport,
} from './src/allocator.js';

export { createOpenCostServer } from './src/server.js';

export const openCostConfig = {
  prometheusEndpoint: 'http://127.0.0.1:8428',
  finopsAgentHook: 'https://aco.perfops.shop/api/v1/ingest/opencost',
  currency: 'USD',
};
