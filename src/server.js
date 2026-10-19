/**
 * PerfOps OpenCost HTTP Microservice
 * Default PORT: 4051
 */

import http from 'node:http';
import { URL } from 'node:url';
import { computeAllocationReport, ESTATE_CONTAINERS } from './allocator.js';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

export function createOpenCostServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'perfops-opencost',
        version: '1.0.0',
        estateContainers: ESTATE_CONTAINERS.length,
        integrations: ['finops-cost-agent', 'aco.perfops.shop', 'globex'],
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/allocation/compute') {
      try {
        const windowParam = parsedUrl.searchParams.get('window') || '7d';
        const aggregateParam = parsedUrl.searchParams.get('aggregate') || 'namespace';
        const report = computeAllocationReport({
          window: windowParam,
          aggregate: aggregateParam,
        });
        sendJson(res, 200, report);
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v1/estate-containers') {
      try {
        const windowParam = parsedUrl.searchParams.get('window') || '30d';
        const report = computeAllocationReport({
          window: windowParam,
          aggregate: 'container',
        });
        sendJson(res, 200, {
          estate: 'perfops-globex-prod',
          host: '72.62.71.140',
          window: windowParam,
          summary: report.summary,
          containers: report.containers,
        });
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/v1/allocate') {
      try {
        const body = await readJsonBody(req);
        const containers = Array.isArray(body) ? body : body.containers;
        const report = computeAllocationReport({
          containers,
          window: body.window || '7d',
          aggregate: body.aggregate || 'namespace',
          rates: body.rates,
        });
        sendJson(res, 200, report);
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    sendJson(res, 404, { error: `Route ${req.method} ${pathname} not found` });
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
