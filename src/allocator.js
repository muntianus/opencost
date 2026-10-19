/**
 * PerfOps OpenCost Kubernetes & Docker Container Cost Allocation Engine
 * Computes real-time CPU, RAM (`cgroup` limits vs actual usage), PV storage, and network egress
 * cost allocation across namespaces/containers, calculates container efficiency score (%),
 * and flags OOM-risk or over-provisioned containers.
 */

export const DEFAULT_RATES = {
  cpuCoreHourUsd: 0.0316,      // ~$23.07 / vCPU-month
  ramGbHourUsd: 0.0042,        // ~$3.07 / GB-month
  pvGbHourUsd: 0.00011,        // ~$0.08 / GB-month (gp3/NVMe equivalent)
  egressGbUsd: 0.015,          // $0.015 / GB network egress
  usdToRub: 96.5,
};

export const WINDOW_HOURS_MAP = {
  '1h': 1,
  '24h': 24,
  '1d': 24,
  '7d': 168,
  '30d': 730,
  month: 730,
};

/**
 * Default PerfOps & Globex production container estate telemetry
 */
export const ESTATE_CONTAINERS = [
  {
    name: 'globex-backend-1',
    namespace: 'globex',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 1.0,
    cpuLimitCores: 2.0,
    cpuUsageAvgCores: 0.68,
    ramRequestMb: 512,
    ramLimitMb: 1024,
    ramUsageAvgMb: 640,
    pvStorageGb: 10,
    networkEgressGbPerDay: 2.4,
  },
  {
    name: 'globex-db-1',
    namespace: 'globex',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 1.0,
    cpuLimitCores: 2.0,
    cpuUsageAvgCores: 0.74,
    ramRequestMb: 1024,
    ramLimitMb: 2048,
    ramUsageAvgMb: 1820, // High RAM utilization -> OOM risk (>85% of limit)
    pvStorageGb: 40,
    networkEgressGbPerDay: 1.1,
  },
  {
    name: 'ops-prometheus',
    namespace: 'observability',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 0.5,
    cpuLimitCores: 1.0,
    cpuUsageAvgCores: 0.35,
    ramRequestMb: 1024,
    ramLimitMb: 1536,
    ramUsageAvgMb: 1120,
    pvStorageGb: 25,
    networkEgressGbPerDay: 0.8,
  },
  {
    name: 'ops-grafana',
    namespace: 'observability',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 0.5,
    cpuLimitCores: 1.0,
    cpuUsageAvgCores: 0.09,
    ramRequestMb: 512,
    ramLimitMb: 1024,
    ramUsageAvgMb: 165, // Over-provisioned (<25% efficiency)
    pvStorageGb: 5,
    networkEgressGbPerDay: 0.5,
  },
  {
    name: 'ops-cadvisor',
    namespace: 'observability',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 0.25,
    cpuLimitCores: 0.5,
    cpuUsageAvgCores: 0.18,
    ramRequestMb: 256,
    ramLimitMb: 384,
    ramUsageAvgMb: 245,
    pvStorageGb: 2,
    networkEgressGbPerDay: 0.3,
  },
  {
    name: 'aco',
    namespace: 'finops',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 0.5,
    cpuLimitCores: 1.0,
    cpuUsageAvgCores: 0.38,
    ramRequestMb: 512,
    ramLimitMb: 768,
    ramUsageAvgMb: 490,
    pvStorageGb: 8,
    networkEgressGbPerDay: 0.9,
  },
  {
    name: 'perfops-site',
    namespace: 'perfops-web',
    node: 'vps-72-62-71-140',
    cpuRequestCores: 0.5,
    cpuLimitCores: 1.0,
    cpuUsageAvgCores: 0.11,
    ramRequestMb: 512,
    ramLimitMb: 1024,
    ramUsageAvgMb: 140, // Over-provisioned
    pvStorageGb: 4,
    networkEgressGbPerDay: 1.8,
  },
];

export function parseWindowHours(windowStr = '7d') {
  if (typeof windowStr === 'number' && windowStr > 0) {
    return windowStr;
  }
  const key = String(windowStr).trim().toLowerCase();
  if (WINDOW_HOURS_MAP[key]) {
    return WINDOW_HOURS_MAP[key];
  }
  const match = key.match(/^(\d+)(h|d)$/);
  if (match) {
    const val = Number(match[1]);
    return match[2] === 'd' ? val * 24 : val;
  }
  return 168; // default 7d
}

/**
 * Evaluates a single container's cost allocation, cgroup efficiency %, and health flags.
 */
export function allocateSingleContainer(
  container,
  windowHours = 168,
  rates = DEFAULT_RATES
) {
  const cpuLimitCores = Number(container.cpuLimitCores || container.cpuRequestCores || 1);
  const cpuRequestCores = Number(container.cpuRequestCores || cpuLimitCores * 0.5);
  const cpuUsageAvgCores = Number(container.cpuUsageAvgCores ?? cpuRequestCores * 0.5);

  const ramLimitMb = Number(container.ramLimitMb || container.ramRequestMb || 512);
  const ramRequestMb = Number(container.ramRequestMb || ramLimitMb * 0.5);
  const ramUsageAvgMb = Number(container.ramUsageAvgMb ?? ramRequestMb * 0.5);

  const pvStorageGb = Number(container.pvStorageGb || 0);
  const networkEgressGbPerDay = Number(container.networkEgressGbPerDay || 0);

  // Billable allocation uses max(request, usage) and tracks cgroup limit slack
  const billableCpuCores = Math.max(cpuRequestCores, cpuUsageAvgCores);
  const billableRamGb = Math.max(ramRequestMb, ramUsageAvgMb) / 1024;
  const limitRamGb = ramLimitMb / 1024;

  const cpuCostUsd = Number((billableCpuCores * rates.cpuCoreHourUsd * windowHours).toFixed(4));
  const ramCostUsd = Number((billableRamGb * rates.ramGbHourUsd * windowHours).toFixed(4));
  const pvCostUsd = Number((pvStorageGb * rates.pvGbHourUsd * windowHours).toFixed(4));
  const egressGbTotal = Number(((networkEgressGbPerDay / 24) * windowHours).toFixed(3));
  const networkCostUsd = Number((egressGbTotal * rates.egressGbUsd).toFixed(4));

  const totalCostUsd = Number(
    (cpuCostUsd + ramCostUsd + pvCostUsd + networkCostUsd).toFixed(4)
  );
  const monthlyProjectedUsd = Number(
    ((totalCostUsd / windowHours) * 730).toFixed(2)
  );
  const monthlyProjectedRub = Number(
    (monthlyProjectedUsd * (rates.usdToRub || DEFAULT_RATES.usdToRub)).toFixed(2)
  );

  // Efficiency vs cgroup limits and requests
  const cpuEfficiencyVsLimit = cpuLimitCores > 0 ? (cpuUsageAvgCores / cpuLimitCores) * 100 : 0;
  const ramEfficiencyVsLimit = ramLimitMb > 0 ? (ramUsageAvgMb / ramLimitMb) * 100 : 0;
  const efficiencyScorePct = Number(
    (cpuEfficiencyVsLimit * 0.5 + ramEfficiencyVsLimit * 0.5).toFixed(1)
  );

  const oomRisk = ramEfficiencyVsLimit >= 85;
  const overProvisioned = !oomRisk && efficiencyScorePct < 25;

  let healthStatus = 'OPTIMAL';
  let recommendation = 'Container cgroup limits and requests are well balanced.';
  if (oomRisk) {
    healthStatus = 'OOM_RISK';
    recommendation = `RAM usage (${ramUsageAvgMb}MB) is ${ramEfficiencyVsLimit.toFixed(1)}% of cgroup limit (${ramLimitMb}MB). Increase memory limit to >= ${Math.ceil((ramUsageAvgMb * 1.35) / 128) * 128}MB.`;
  } else if (overProvisioned) {
    healthStatus = 'OVER_PROVISIONED';
    recommendation = `Efficiency score is ${efficiencyScorePct}% (CPU ${cpuEfficiencyVsLimit.toFixed(1)}%, RAM ${ramEfficiencyVsLimit.toFixed(1)}%). Right-size cgroup limits to reclaim idle capacity.`;
  }

  return {
    name: container.name,
    namespace: container.namespace || 'default',
    node: container.node || 'vps-72-62-71-140',
    windowHours,
    cgroups: {
      cpuRequestCores,
      cpuLimitCores,
      cpuUsageAvgCores,
      ramRequestMb,
      ramLimitMb,
      ramUsageAvgMb,
      limitRamGb: Number(limitRamGb.toFixed(2)),
      cpuUtilizationPct: Number(cpuEfficiencyVsLimit.toFixed(1)),
      ramUtilizationPct: Number(ramEfficiencyVsLimit.toFixed(1)),
    },
    efficiencyScorePct,
    flags: {
      oomRisk,
      overProvisioned,
      healthStatus,
    },
    recommendation,
    costs: {
      cpuCostUsd,
      ramCostUsd,
      pvCostUsd,
      networkCostUsd,
      totalCostUsd,
      monthlyProjectedUsd,
      monthlyProjectedRub,
    },
  };
}

/**
 * Computes full allocation report and OpenCost-compatible aggregation map.
 */
export function computeAllocationReport(options = {}) {
  const containers = Array.isArray(options.containers) && options.containers.length > 0
    ? options.containers
    : ESTATE_CONTAINERS;
  const windowStr = options.window || '7d';
  const windowHours = parseWindowHours(windowStr);
  const aggregateBy = options.aggregate || 'namespace';
  const rates = { ...DEFAULT_RATES, ...(options.rates || {}) };

  const allocatedContainers = containers.map((c) =>
    allocateSingleContainer(c, windowHours, rates)
  );

  // Aggregate each source container with its own allocation by index: names can repeat across namespaces.
  // Build OpenCost-compatible allocation map keyed by namespace or container
  const allocationSet = {};
  for (const [index, item] of allocatedContainers.entries()) {
    const key =
      aggregateBy === 'container' || aggregateBy === 'pod'
        ? item.name
        : item.namespace;

    if (!allocationSet[key]) {
      allocationSet[key] = {
        name: key,
        properties: {
          cluster: 'perfops-prod-estate',
          node: item.node,
          namespace: item.namespace,
          aggregateBy,
        },
        window: {
          durationHours: windowHours,
          label: String(windowStr),
        },
        cpuCores: 0,
        cpuCost: 0,
        ramBytes: 0,
        ramCost: 0,
        pvBytes: 0,
        pvCost: 0,
        networkCost: 0,
        totalCost: 0,
        totalEfficiency: 0,
        containerCount: 0,
        oomRiskCount: 0,
        overProvisionedCount: 0,
        _effSum: 0,
      };
    }

    const bucket = allocationSet[key];
    bucket.cpuCores = Number((bucket.cpuCores + item.cgroups.cpuUsageAvgCores).toFixed(3));
    bucket.cpuCost = Number((bucket.cpuCost + item.costs.cpuCostUsd).toFixed(4));
    bucket.ramBytes += Math.round(item.cgroups.ramUsageAvgMb * 1024 * 1024);
    bucket.ramCost = Number((bucket.ramCost + item.costs.ramCostUsd).toFixed(4));
    bucket.pvBytes += Math.round((containers[index].pvStorageGb || 0) * 1024 ** 3);
    bucket.pvCost = Number((bucket.pvCost + item.costs.pvCostUsd).toFixed(4));
    bucket.networkCost = Number((bucket.networkCost + item.costs.networkCostUsd).toFixed(4));
    bucket.totalCost = Number((bucket.totalCost + item.costs.totalCostUsd).toFixed(4));
    bucket.containerCount += 1;
    bucket._effSum += item.efficiencyScorePct;
    if (item.flags.oomRisk) bucket.oomRiskCount += 1;
    if (item.flags.overProvisioned) bucket.overProvisionedCount += 1;
    bucket.totalEfficiency = Number(
      (bucket._effSum / bucket.containerCount / 100).toFixed(4)
    );
  }

  for (const key of Object.keys(allocationSet)) {
    delete allocationSet[key]._effSum;
  }

  const totalWindowUsd = Number(
    allocatedContainers.reduce((acc, c) => acc + c.costs.totalCostUsd, 0).toFixed(4)
  );
  const totalMonthlyProjectedUsd = Number(
    allocatedContainers.reduce((acc, c) => acc + c.costs.monthlyProjectedUsd, 0).toFixed(2)
  );
  const totalMonthlyProjectedRub = Number(
    allocatedContainers.reduce((acc, c) => acc + c.costs.monthlyProjectedRub, 0).toFixed(2)
  );
  const avgEfficiencyPct = Number(
    (
      allocatedContainers.reduce((acc, c) => acc + c.efficiencyScorePct, 0) /
      allocatedContainers.length
    ).toFixed(1)
  );

  return {
    code: 200,
    status: 'success',
    window: String(windowStr),
    windowHours,
    aggregate: aggregateBy,
    integrations: {
      finopsCostAgent: 'https://aco.perfops.shop/api/v1/ingest/opencost',
      prometheusEndpoint: 'http://127.0.0.1:9090',
      cadvisorEndpoint: 'http://127.0.0.1:8080',
      globexPortal: 'https://globex.perfops.tech',
    },
    summary: {
      containerCount: allocatedContainers.length,
      totalWindowUsd,
      totalMonthlyProjectedUsd,
      totalMonthlyProjectedRub,
      avgEfficiencyPct,
      oomRiskContainers: allocatedContainers
        .filter((c) => c.flags.oomRisk)
        .map((c) => c.name),
      overProvisionedContainers: allocatedContainers
        .filter((c) => c.flags.overProvisioned)
        .map((c) => c.name),
    },
    data: [allocationSet],
    containers: allocatedContainers,
  };
}
