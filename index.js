/**
 * PerfOps OpenCost SDK & Container Cost Allocation Entrypoint
 */

export {
  DEFAULT_RATES,
  WINDOW_HOURS_MAP,
  ESTATE_CONTAINERS,
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
