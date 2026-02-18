# KubeBeaver

KubeBeaver is an intelligent Kubernetes troubleshooting assistant. It collects cluster signals (events, describe, logs, status, and optional metrics), then uses an LLM to produce a **diagnosis**, **likely root causes**, **recommended actions**, and **suggested kubectl commands**.

## Product goal

You select a **namespace** and a **target** (Pod, Deployment, StatefulSet, or Node), click **Analyze**, and get:

- A short **summary** of what is happening
- **Likely root causes** with confidence and evidence references
- A **checklist of recommended actions**
- **Suggested kubectl commands** to validate or fix
- **Raw evidence** (sanitized) for transparency
- **Usage metrics**: tokens consumed and response time displayed in the UI

## Key features

- **Automatic data collection**: Gathers pod/Deployment/StatefulSet/Node details, events, logs, and status
- **LLM-powered analysis**: Uses Groq or OpenAI-compatible APIs to generate intelligent diagnostics
- **Security**: Automatic sanitization of secrets, tokens, and sensitive data before sending to LLM
- **Analysis history**: SQLite database (default) or MySQL/Postgres stores all analyses for review and comparison
- **Performance metrics**: Tracks token usage and response time for each analysis
- **Multi-context support**: Works with multiple Kubernetes contexts
- **In-cluster deployment**: Can run inside Kubernetes with RBAC for least-privilege access
- **Cluster health scan**: On-demand namespace or cluster-wide scan for failure signals (failing pods, replica mismatches, node pressure) with prioritized findings and suggested kubectl commands

## Roadmap

### Now (v1.0 - Current)

- ✅ Single resource analysis (Pod, Deployment, StatefulSet, Node)
- ✅ Evidence collection (events, logs, describe, status)
- ✅ LLM-powered diagnostics (Groq, OpenAI-compatible)
- ✅ Evidence sanitization and truncation
- ✅ Analysis history (SQLite)
- ✅ Multi-context support
- ✅ In-cluster deployment with RBAC
- ✅ **Cluster health scan (on-demand)**: Scan a namespace or the whole cluster for failure signals; view findings by severity/category with evidence and suggested commands

### Next (v2.0 - Q2 2026)

See [Milestone v2.0.0-alpha], [Milestone v2.0.0-beta], [Milestone v2.0.0-rc] for planned features:

- [ ] **Heuristics Engine**: Additional deterministic checks (current scan covers CrashLoopBackOff, ImagePullBackOff, replica mismatch, node pressure)
- [ ] **Comparison**: Compare two analyses side-by-side (what changed and why)
- [ ] **Incidents**: Group analyses into incidents with timeline and export
- [ ] **Scheduled Scans**: Automated health checks (daily/weekly)
- [ ] **Webhooks**: Slack notifications and generic webhook integrations
- [ ] **Export**: JSON, Markdown, and PDF export for incidents and analyses
- [ ] **MySQL Support**: Production-grade database with Alembic migrations (SQLite fallback still available)

### Later (v2.1+)

- [ ] **Multi-Cluster**: Scan and aggregate findings across multiple clusters
- [ ] **Custom Heuristics**: User-defined rules (YAML/JSON)
- [ ] **Advanced Metrics**: Cost tracking, performance analytics, Grafana dashboards
- [ ] **RBAC**: Fine-grained permissions (who can scan what)
- [ ] **API Keys**: Per-user API keys for programmatic access
- [ ] **Trend Analysis**: Resource health over time (requires time-series DB)

**Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved. We welcome contributions to any roadmap item.

## Repository layout

- **`/backend`** – FastAPI API (Python): K8s client, collectors, sanitization, LLM integration, analysis history
- **`/frontend`** – React + TypeScript + Vite: single-page UI with form and markdown + evidence result
- **`/deploy`** – Kubernetes manifests in `deploy/k8s/`. Docker Compose at repo root: `compose.yaml`.

## Quick start (Docker)

Run the project with Docker Compose. No local Python or Node setup required.

### Prerequisites

- **Docker** and **Docker Compose**
- **kubectl** and a working **KUBECONFIG** (cluster access)
- For LLM: [Groq](https://console.groq.com) API key or an OpenAI-compatible endpoint (e.g. [Ollama](https://ollama.ai) on the host)

### Run

```bash
# 1. Create Docker network and volume (required by compose)
docker network create kubebeaver-net 2>/dev/null || true
docker volume create kubebeaver-history 2>/dev/null || true

# 2. Configure environment
cp .env.example .env
# Edit .env: set KUBECONFIG path, LLM_PROVIDER, GROQ_API_KEY (or OPENAI_* for Ollama)

# 3. Start backend, Redis, and frontend
docker compose up --build
```

- **Frontend:** http://localhost:8080 (proxies `/api` to the backend)
- **Backend:** http://localhost:8000

All settings come from `.env` in the repo root (see `.env.example`). Use `LLM_PROVIDER=groq` with `GROQ_API_KEY`, or `LLM_PROVIDER=openai_compatible` with `OPENAI_BASE_URL` (e.g. `http://host.docker.internal:11434/v1` for Ollama on the host).

Analysis history is stored in the `kubebeaver-history` volume and persists across restarts.

In the UI (http://localhost:8080): choose context, namespace, target type (Pod / Deployment / StatefulSet / Node), resource name, then **Analyze**. View the markdown result and expand **Raw evidence** if needed.

Use the **Scan** tab to run a cluster health scan: pick scope (namespace or cluster), select a namespace when scoping to one, optionally enable **Include logs in evidence**, then **Scan**. Results show a summary (counts by severity), a filterable list of findings, and a detail panel (evidence + suggested kubectl commands) when you click a finding.

---

## Running inside the cluster (Kubernetes)

The app can run inside the cluster with a ServiceAccount and RBAC (least privilege). It then uses the in-cluster config and does not need a kubeconfig file.

### 1. Build and load images (e.g. kind)

```bash
docker build -t kubebeaver-backend:latest ./backend
docker build -t kubebeaver-frontend:latest ./frontend
kind load docker-image kubebeaver-backend:latest kubebeaver-frontend:latest
```

### 2. Deploy

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/rbac.yaml
kubectl apply -f deploy/k8s/backend-config.yaml
kubectl apply -f deploy/k8s/backend-deployment.yaml
kubectl apply -f deploy/k8s/frontend-deployment.yaml
kubectl apply -f deploy/k8s/ingress.yaml
```

### 3. Configure LLM and secrets

Edit `deploy/k8s/backend-config.yaml` (ConfigMap) for `OPENAI_BASE_URL`, `OPENAI_MODEL`, etc.  
Put API keys in the Secret `kubebeaver-secrets` (e.g. `GROQ_API_KEY`, `OPENAI_API_KEY`):

```bash
kubectl create secret generic kubebeaver-secrets -n kubebeaver \
  --from-literal=GROQ_API_KEY=your_key \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 4. In-cluster behavior

- Set `IN_CLUSTER=true` (or rely on automatic detection when `KUBERNETES_SERVICE_HOST` is set).
- The backend uses the ServiceAccount `kubebeaver` and the ClusterRole `kubebeaver-reader`.
- RBAC is documented in `deploy/k8s/rbac.yaml`: namespaces, pods, events, nodes, deployments, statefulsets, and optional metrics.k8s.io.

---

## Configuration (environment)

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `groq` or `openai_compatible` | `openai_compatible` |
| `GROQ_API_KEY` | Groq API key | - |
| `GROQ_MODEL` | Groq model name (e.g. `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`) | `llama-3.3-70b-versatile` |
| `OPENAI_BASE_URL` | Base URL for OpenAI-compatible API (Ollama, Exo, OpenAI, etc.) | `http://localhost:11434/v1` |
| `OPENAI_API_KEY` | API key (if required by endpoint) | - |
| `OPENAI_MODEL` | Model name | `llama3.2` |
| `REQUEST_TIMEOUT` | LLM request timeout (seconds) | 120 |
| `MAX_EVIDENCE_CHARS` | Max characters of evidence sent to LLM | 60000 |
| `IN_CLUSTER` | Set to `true` when running inside Kubernetes | `false` |
| `KUBECONFIG` | Path to kubeconfig (local/dev) | `~/.kube/config` |
| `HISTORY_DB_PATH` | SQLite path for analysis history (used when DATABASE_URL is not set) | `data/kubebeaver.db` |
| `DATABASE_URL` | External database URL (optional; MySQL or Postgres). If set, overrides HISTORY_DB_PATH | - |
| `REDIS_URL` | Redis URL for response cache (optional; leave empty to disable cache) | - |
| `CACHE_TTL_CONTEXTS` | Cache TTL for context list (seconds) | 60 |
| `CACHE_TTL_NAMESPACES` | Cache TTL for namespace list (seconds) | 60 |
| `CACHE_TTL_RESOURCES` | Cache TTL for resource list (seconds) | 30 |
| `CACHE_TTL_ANALYZE` | Cache TTL for analysis results (seconds) | 300 |
| `SCAN_MAX_FINDINGS` | Max findings per scan (payload bound) | 200 |
| `SCAN_PENDING_MINUTES` | Pod Pending longer than this (minutes) is reported | 5 |

**Database:**  
By default, KubeBeaver uses SQLite (stored in `kubebeaver-history` volume). To use MySQL or Postgres, set `DATABASE_URL` in `.env`:
- MySQL: `mysql+aiomysql://user:password@host:3306/database`
- Postgres: `postgresql+asyncpg://user:password@host:5432/database`

MySQL is started by default with `docker compose up`. To use it, set `DATABASE_URL=mysql+aiomysql://kubebeaver:kubebeaver@mysql:3306/kubebeaver` in `.env`.

**Redis cache (optional):**  
With Docker Compose, Redis is included. Set `REDIS_URL=redis://redis:6379/0` in `.env` to cache API responses (contexts, namespaces, resources, and analysis results). If unset, no cache is used.

---

## API overview

- **GET /api/health** – Health and flags: `kube_connected`, `llm_configured`
- **GET /api/contexts** – List kube contexts (or `in-cluster` when applicable)
- **GET /api/namespaces** – List namespaces (optional `?context=...`)
- **GET /api/resources?namespace=...&kind=Pod|Deployment|StatefulSet|Node** – List resources for the form
- **POST /api/analyze** – Body: `{ "context?", "namespace?", "kind", "name", "include_previous_logs?" }`  
  Returns: `analysis_json`, `analysis_markdown`, `evidence`, `truncation_report`, `tokens_used`, `response_time_ms`, `error?`
  - `tokens_used`: Number of tokens consumed by the LLM call
  - `response_time_ms`: Response time in milliseconds (displayed as seconds if ≥1000ms)
- **GET /api/history** – List recent analyses (saved automatically to SQLite)
- **GET /api/history/{id}** – Get one analysis by id with full details
- **POST /api/scan** – Run cluster health scan. Body: `{ "context?", "scope": "namespace"|"cluster", "namespace?" (required when scope=namespace), "include_logs?" }`. Returns: `id`, `summary_markdown`, `error?`, `findings[]`, `counts` (by severity).
- **GET /api/scans** – List recent scans (`?limit=50`).
- **GET /api/scans/{id}** – Get scan by id with full findings and summary.

---

## Security and sanitization

- **Evidence** is sanitized before being sent to the LLM: tokens, bearer/auth headers, env vars with names like `PASSWORD`, `SECRET`, `TOKEN`, `KEY`, and long base64 strings are redacted.
- Logs and events are truncated (e.g. 300 lines per container, 50 events); total evidence is capped at `MAX_EVIDENCE_CHARS`.
- RBAC is least-privilege: only the reads needed for listing and describing resources and fetching logs (see `deploy/k8s/rbac.yaml`).
- Do not expose the backend or Ingress publicly without authentication; the API has no built-in auth.

---

## Example request/response

**POST /api/analyze**

```json
{
  "namespace": "default",
  "kind": "Pod",
  "name": "my-app-7d8f9c-xk2lm",
  "include_previous_logs": true
}
```

**Response (excerpt)**

```json
{
  "analysis_json": {
    "summary": "Pod is in CrashLoopBackOff; the main container exits with code 1.",
    "likely_root_causes": [
      { "cause": "Application error or missing config", "confidence": "high", "evidence_refs": ["pod.status.containerStatuses[0].lastState.terminated"] }
    ],
    "recommended_actions": ["Check logs with kubectl logs -p ...", "Verify config map and secrets"],
    "kubectl_commands": ["kubectl logs default/my-app-7d8f9c-xk2lm -p --tail=100"],
    "follow_up_questions": [],
    "risk_notes": []
  },
  "analysis_markdown": "## Summary\n\nPod is in CrashLoopBackOff...",
  "evidence": { ... },
  "truncation_report": { "truncated": false, ... },
  "tokens_used": 1234,
  "response_time_ms": 2345,
  "error": null
}
```

The UI displays metrics in the result header: **"Result - 1,234 tokens - 2.3s"** (time shown in seconds if ≥1000ms, otherwise in milliseconds).

---

## How to verify (Scan)

1. **Start the stack:** `docker compose up --build` (or run backend + frontend locally).
2. **Open Scan tab:** http://localhost:8080 → click **Scan**.
3. **Run a scan:** Choose scope **Namespace**, select a namespace, click **Scan**. Expect a summary (e.g. counts by severity) and a list of findings (or “Total findings: 0” if the namespace is healthy).
4. **List scans:** `curl -s http://localhost:8000/api/scans | jq` (or use the “Recent scans” list in the UI). Expect an array of scan objects with `id`, `created_at`, `scope`, `namespace`, `findings_count`, `error?`.
5. **Get scan detail:** `curl -s http://localhost:8000/api/scans/<id> | jq` (replace `<id>` with a scan id from step 4). Expect `summary_markdown`, `findings[]` (each with `severity`, `category`, `title`, `description`, `affected_refs`, `suggested_commands`, `evidence_snippet?`).
6. **Click a finding** in the UI: detail panel shows evidence (if collected) and suggested kubectl commands.

---

## License

See [LICENSE](LICENSE).
