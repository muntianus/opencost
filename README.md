# PerfOps OpenCost — Kubernetes & Docker Container Cost Allocation Service

Real-time container CPU, RAM (`cgroup` limits vs actual usage), PV storage, and network egress cost allocation, efficiency scoring, and OOM-risk / over-provisioning detection for the **PerfOps & Globex** container estate.

## Architecture & Features

- **`src/allocator.js`**:
  - Computes real-time CPU, RAM (`cgroup` limits vs actual usage), persistent volume storage, and network egress cost allocation across namespaces and containers.
  - Pre-configured with the production PerfOps/Globex container estate (`globex-backend-1`, `globex-db-1`, `ops-prometheus`, `ops-grafana`, `ops-cadvisor`, `aco`, `perfops-site`).
  - Calculates container efficiency score (`%`) and flags `OOM_RISK` (`>=85%` of RAM cgroup limit) or `OVER_PROVISIONED` (`<25%` composite efficiency).
- **`src/server.js`**: Zero-dependency Node.js HTTP microservice (default `PORT=4051`) compatible with OpenCost `/allocation/compute` queries and integrated with `finops-cost-agent`, `aco.perfops.shop`, and `globex`.

## API Endpoints (`PORT=4051`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health check and estate metadata |
| `GET` | `/allocation/compute?window=7d&aggregate=namespace` | OpenCost-compatible allocation aggregation endpoint |
| `POST` | `/api/v1/allocate` | Computes cost allocation and cgroup efficiency for custom container telemetry |
| `GET` | `/api/v1/estate-containers` | Returns full allocation and cgroup health report for the PerfOps/Globex container estate |

### `window` parameter

`window` accepts `<number><unit>`, where the unit is `m` (minutes), `h` (hours), `d` (days) or `w` (weeks). Parsing is case-insensitive and surrounding whitespace is ignored:

| Example | Duration |
| :--- | :--- |
| `15m` | 0.25h |
| `30m` | 0.5h |
| `1h` / `24h` | 1h / 24h |
| `7d` / `1w` | 168h |
| `30d` | 720h |

- **Default:** `7d` (168h) when `window` is omitted or blank (`/allocation/compute`, `POST /api/v1/allocate`). `/api/v1/estate-containers` keeps its own default of `30d`.
- **Maximum:** `31d` (744h). Larger windows are rejected.
- **Invalid values:** malformed input (for example `30`, `banana`, `0m`) or a window above the limit returns **HTTP 400** with `{"code":"INVALID_WINDOW","error":"..."}`. There is no silent fallback to 168h.
- Programmatic callers may pass a number, which is interpreted as hours.

All cost components are multiplied by the parsed window duration, so `window=30m` bills 0.5 hours instead of 168 hours.

## Quick Start

```bash
# Run tests
node --test tests/opencost.test.js

# Start HTTP microservice on port 4051
npm start
```

## Contact / Support

PerfOps official Telegram contact: [@perfops_ai_manager](https://t.me/perfops_ai_manager).

For security vulnerabilities, use private vulnerability reporting rather than public Telegram messages.
