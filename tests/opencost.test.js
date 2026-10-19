import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTATE_CONTAINERS,
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  WindowValidationError,
  allocateSingleContainer,
  computeAllocationReport,
  parseWindowHours,
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

test('parseWindowHours maps minutes, hours, days, and weeks to the correct duration', () => {
  // Regression: `30m` used to fall through to the 168h default and inflate costs 336x.
  const cases = [
    ['30m', 0.5],
    ['15m', 0.25],
    ['1m', 0.016667],
    ['1h', 1],
    ['24h', 24],
    ['36h', 36],
    ['1d', 24],
    ['7d', 168],
    ['30d', 720],
    ['1w', 168],
    ['2w', 336],
    ['1W', 168],
    ['  24H  ', 24],
    [' 7d ', 168],
    [12, 12],
    [0.5, 0.5],
  ];

  for (const [input, expected] of cases) {
    assert.equal(parseWindowHours(input), expected, `${input} should parse to ${expected}h`);
  }

  assert.equal(parseWindowHours(), DEFAULT_WINDOW_HOURS);
  assert.equal(parseWindowHours(undefined), 168);
  assert.equal(parseWindowHours(null), 168);
  assert.equal(parseWindowHours(''), 168);
  assert.equal(parseWindowHours('   '), 168);
  assert.equal(parseWindowHours('31d'), MAX_WINDOW_HOURS);
});

test('parseWindowHours rejects malformed, zero, and oversized windows', () => {
  const invalid = ['30', 'banana', '1x', '1y', '-1h', '0m', '0h', '1.5x', 'h', {}];

  for (const value of invalid) {
    assert.throws(
      () => parseWindowHours(value),
      (err) => {
        assert.ok(err instanceof WindowValidationError, `${value} should raise WindowValidationError`);
        assert.equal(err.code, 'INVALID_WINDOW');
        assert.equal(err.statusCode, 400);
        return true;
      },
      `expected ${JSON.stringify(value)} to be rejected`
    );
  }

  assert.throws(() => parseWindowHours('32d'), /maximum allowed window is 31d \(744h\)/);
  assert.throws(() => parseWindowHours('5w'), /maximum allowed window is 31d \(744h\)/);
  assert.throws(() => parseWindowHours(MAX_WINDOW_HOURS + 1), /maximum allowed window is 31d \(744h\)/);
  assert.throws(() => parseWindowHours(0), /greater than zero/);
  assert.throws(() => parseWindowHours(-1), /greater than zero/);
});

test('costs scale with the actual window duration instead of a fixed 168h', () => {
  const container = {
    name: 'cpu-only',
    namespace: 'batch',
    cpuRequestCores: 1,
    cpuLimitCores: 1,
    cpuUsageAvgCores: 1,
    ramRequestMb: 1024,
    ramLimitMb: 1024,
    ramUsageAvgMb: 1024,
    pvStorageGb: 0,
    networkEgressGbPerDay: 24,
  };

  const halfHour = computeAllocationReport({ window: '30m', containers: [container] });
  const week = computeAllocationReport({ window: '7d', containers: [container] });

  assert.equal(halfHour.window, '30m');
  assert.equal(halfHour.windowHours, 0.5);
  assert.equal(week.windowHours, 168);

  const halfCosts = halfHour.containers[0].costs;
  assert.equal(halfCosts.cpuCostUsd, 0.0158); // 1 core * $0.0316/h * 0.5h
  assert.equal(halfCosts.ramCostUsd, 0.0021); // 1 GB * $0.0042/h * 0.5h
  assert.equal(halfCosts.networkCostUsd, 0.0075); // 0.5 GB * $0.015/GB
  assert.equal(halfCosts.totalCostUsd, 0.0254);
  assert.equal(halfCosts.monthlyProjectedUsd, 37.08); // (0.0254 / 0.5h) * 730h

  // The same workload over 7d costs exactly 336x more than over 30m.
  assert.equal(week.containers[0].costs.totalCostUsd, Number((halfCosts.totalCostUsd * 336).toFixed(4)));
  assert.equal(week.summary.totalWindowUsd, 8.5344);
});

test('HTTP server returns 400 for malformed and oversized windows', async () => {
  const server = createOpenCostServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const malformedRes = await fetch(`${baseUrl}/allocation/compute?window=banana`);
    assert.equal(malformedRes.status, 400);
    const malformedBody = await malformedRes.json();
    assert.equal(malformedBody.code, 'INVALID_WINDOW');
    assert.match(malformedBody.error, /Invalid window/);

    const oversizedRes = await fetch(`${baseUrl}/allocation/compute?window=32d`);
    assert.equal(oversizedRes.status, 400);
    assert.match((await oversizedRes.json()).error, /maximum allowed window is 31d \(744h\)/);

    const estateRes = await fetch(`${baseUrl}/api/v1/estate-containers?window=30x`);
    assert.equal(estateRes.status, 400);
    assert.equal((await estateRes.json()).code, 'INVALID_WINDOW');

    const postRes = await fetch(`${baseUrl}/api/v1/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: '999d', containers: [] }),
    });
    assert.equal(postRes.status, 400);
    assert.equal((await postRes.json()).code, 'INVALID_WINDOW');

    const validRes = await fetch(`${baseUrl}/allocation/compute?window=30m`);
    assert.equal(validRes.status, 200);
    const validBody = await validRes.json();
    assert.equal(validBody.window, '30m');
    assert.equal(validBody.windowHours, 0.5);

    const defaultRes = await fetch(`${baseUrl}/allocation/compute`);
    assert.equal(defaultRes.status, 200);
    assert.equal((await defaultRes.json()).windowHours, 168);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
