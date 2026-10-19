import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTATE_CONTAINERS,
  allocateSingleContainer,
  computeAllocationReport,
} from '../src/allocator.js';
import { createOpenCostServer } from '../src/server.js';

test('allocator includes all required PerfOps/Globex estate containers', () => {
  const requiredNames = [
    'globex-backend-1',
    'globex-db-1',
    'ops-prometheus',
    'ops-grafana',
    'ops-cadvisor',
    'aco',
    'perfops-site',
  ];

  const estateNames = ESTATE_CONTAINERS.map((c) => c.name);
  for (const name of requiredNames) {
    assert.ok(estateNames.includes(name), `Estate should include ${name}`);
  }
});

test('allocator calculates CPU, RAM, PV, and network costs and flags OOM-risk & over-provisioned containers', () => {
  const report = computeAllocationReport({ window: '7d', aggregate: 'namespace' });
  assert.equal(report.code, 200);
  assert.equal(report.summary.containerCount, 7);
  assert.ok(report.summary.totalMonthlyProjectedUsd > 0);
  assert.ok(report.summary.oomRiskContainers.includes('globex-db-1'));
  assert.ok(report.summary.overProvisionedContainers.includes('ops-grafana'));
  assert.ok(report.summary.overProvisionedContainers.includes('perfops-site'));

  const nsBuckets = report.data[0];
  assert.ok(nsBuckets.globex);
  assert.ok(nsBuckets.observability);
  assert.ok(nsBuckets.finops);
});

test('allocateSingleContainer accurately computes efficiency and OOM risk', () => {
  const oomSample = allocateSingleContainer({
    name: 'high-mem-svc',
    namespace: 'prod',
    cpuRequestCores: 1,
    cpuLimitCores: 2,
    cpuUsageAvgCores: 1.5,
    ramRequestMb: 1024,
    ramLimitMb: 2048,
    ramUsageAvgMb: 1900,
    pvStorageGb: 20,
    networkEgressGbPerDay: 5,
  });

  assert.equal(oomSample.flags.oomRisk, true);
  assert.equal(oomSample.flags.healthStatus, 'OOM_RISK');
  assert.ok(oomSample.efficiencyScorePct > 75);
});

test('HTTP server responds to /health, /allocation/compute, /api/v1/estate-containers, and POST /api/v1/allocate', async () => {
  const server = createOpenCostServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.estateContainers, 7);

    const allocRes = await fetch(`${baseUrl}/allocation/compute?window=7d&aggregate=namespace`);
    assert.equal(allocRes.status, 200);
    const allocBody = await allocRes.json();
    assert.equal(allocBody.code, 200);
    assert.ok(allocBody.data[0].globex.totalCost > 0);

    const estateRes = await fetch(`${baseUrl}/api/v1/estate-containers`);
    assert.equal(estateRes.status, 200);
    const estateBody = await estateRes.json();
    assert.equal(estateBody.containers.length, 7);

    const customRes = await fetch(`${baseUrl}/api/v1/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        window: '24h',
        aggregate: 'container',
        containers: [
          {
            name: 'custom-worker',
            namespace: 'batch',
            cpuRequestCores: 2,
            cpuLimitCores: 4,
            cpuUsageAvgCores: 0.2,
            ramRequestMb: 1024,
            ramLimitMb: 4096,
            ramUsageAvgMb: 256,
          },
        ],
      }),
    });
    assert.equal(customRes.status, 200);
    const customBody = await customRes.json();
    assert.equal(customBody.containers[0].flags.overProvisioned, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('allocation preserves storage totals when container names repeat in different namespaces', () => {
  const report = computeAllocationReport({
    window: '24h',
    aggregate: 'namespace',
    containers: [
      { name: 'worker', namespace: 'blue', pvStorageGb: 2, cpuRequestCores: 1, ramRequestMb: 512 },
      { name: 'worker', namespace: 'green', pvStorageGb: 7, cpuRequestCores: 1, ramRequestMb: 512 },
    ],
  });

  assert.equal(report.data[0].blue.pvBytes, 2 * 1024 ** 3);
  assert.equal(report.data[0].green.pvBytes, 7 * 1024 ** 3);
  assert.equal(report.summary.containerCount, 2);
});
