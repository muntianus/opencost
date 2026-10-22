/**
 * PerfOps OpenCost HTTP Microservice
 * Default PORT: 4051
 */

import http from 'node:http';
import { URL } from 'node:url';
import { computeAllocationReport, ESTATE_CONTAINERS } from './allocator.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(body);
}

/** Maps validation failures (invalid/oversized window) to an explicit 400 response. */
function sendError(res, err) {
  const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 400;
  const payload = { error: err?.message || 'Bad request' };
  if (err?.code) {
    payload.code = err.code;
  }
  sendJson(res, statusCode, payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function health(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    service: 'perfops-opencost',
    version: '1.0.0',
    estateContainers: ESTATE_CONTAINERS.length,
    integrations: ['finops-cost-agent', 'aco.perfops.shop', 'globex'],
    timestamp: new Date().toISOString(),
  });
}

function computeAllocation(req, res, url) {
  const windowParam = url.searchParams.get('window') || '7d';
  const aggregateParam = url.searchParams.get('aggregate') || 'namespace';
  sendJson(res, 200, computeAllocationReport({ window: windowParam, aggregate: aggregateParam }));
}

function estateContainers(req, res, url) {
  const windowParam = url.searchParams.get('window') || '30d';
  const report = computeAllocationReport({ window: windowParam, aggregate: 'container' });
  sendJson(res, 200, {
    estate: 'perfops-globex-prod',
    host: '72.62.71.140',
    window: windowParam,
    summary: report.summary,
    containers: report.containers,
  });
}

async function allocate(req, res) {
  const body = await readJsonBody(req);
  const containers = Array.isArray(body) ? body : body.containers;
  const report = computeAllocationReport({
    containers,
    window: body.window || '7d',
    aggregate: body.aggregate || 'namespace',
    rates: body.rates,
  });
  sendJson(res, 200, report);
}

/**
 * Every route the service answers. tests/openapi-contract.test.js keeps this
 * table and docs/api/openapi.json in lockstep.
 */
export const ROUTES = [
  { method: 'GET', path: '/health', handler: health },
  { method: 'GET', path: '/allocation/compute', handler: computeAllocation },
  { method: 'GET', path: '/api/v1/estate-containers', handler: estateContainers },
  { method: 'POST', path: '/api/v1/allocate', handler: allocate },
];

export function createOpenCostServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const route = ROUTES.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      sendJson(res, 404, { error: `Route ${req.method} ${url.pathname} not found` });
      return;
    }
    try {
      await route.handler(req, res, url);
    } catch (err) {
      sendError(res, err);
    }
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  const port = Number(process.env.PORT || 4051);
  const server = createOpenCostServer();
  server.listen(port, () => {
    console.log(`[perfops-opencost] listening on http://0.0.0.0:${port}`);
  });
}
