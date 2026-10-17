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

## Quick Start

```bash
# Run tests
node --test tests/opencost.test.js

# Start HTTP microservice on port 4051
npm start
```
