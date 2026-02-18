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
- **Analysis history**: SQLite database stores all analyses for review and comparison
- **Performance metrics**: Tracks token usage and response time for each analysis
- **Multi-context support**: Works with multiple Kubernetes contexts
- **In-cluster deployment**: Can run inside Kubernetes with RBAC for least-privilege access

## Repository layout

- **`/backend`** – FastAPI API (Python): K8s client, collectors, sanitization, LLM integration, analysis history
- **`/frontend`** – React + TypeScript + Vite: single-page UI with form and markdown + evidence result
- **`/deploy`** – Docker and Kubernetes: `docker-compose.yml` at repo root; K8s manifests in `deploy/k8s/`

## Quick start (local)

### Prerequisites

- Python 3.11+, Node 18+, `kubectl` and a working `KUBECONFIG`
- For LLM: either [Groq](https://console.groq.com) API key or a local OpenAI-compatible endpoint (e.g. [Ollama](https://ollama.ai))

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
# Configure via .env in repo root (see .env.example)
# Or export env vars:
export KUBECONFIG=~/.kube/config
export LLM_PROVIDER=groq
export GROQ_API_KEY=your_groq_key
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend (port 8000).

### 3. Analyze

In the UI: choose context (if multiple), namespace, target type (Pod / Deployment / StatefulSet / Node), resource name, then **Analyze**. View the markdown result and expand **Raw evidence** if needed.

---

## Running with Docker Compose (local)

Build and run backend + frontend; mount your kubeconfig so the backend can talk to the cluster:

```bash
cp .env.example .env
# Edit .env and set KUBECONFIG, LLM_PROVIDER, GROQ_API_KEY, etc.
docker compose up --build
```

- Backend: http://localhost:8000  
- Frontend (proxies /api to backend): http://localhost:8080  

**Note:** All environment variables are configured via `.env` in the repo root (see `.env.example`). The compose file loads this single `.env` file.

- `LLM_PROVIDER=groq` or `openai_compatible`
- `GROQ_API_KEY=...` (for Groq)
- `OPENAI_BASE_URL=...`, `OPENAI_API_KEY=...`, `OPENAI_MODEL=...` (for OpenAI-compatible)
- `OPENAI_BASE_URL=http://host.docker.internal:11434/v1` for Ollama on the host

### Persisting analysis history with Docker volume

By default, the analysis history SQLite database is stored inside the container and will be lost when the container is removed. To persist it across container restarts, create a Docker volume manually:

**Option 1: Named Docker volume (recommended)**

```bash
# Create the volume
docker volume create kubebeaver-history

# Update compose.yaml backend service volumes section to include:
# volumes:
#   - ${KUBECONFIG:-$HOME/.kube/config}:/tmp/kubeconfig:ro
#   - kubebeaver-history:/app/data
```

The database will be stored in the Docker-managed volume at `/var/lib/docker/volumes/kubebeaver-history/_data/kubebeaver.db` (on Linux).

**Option 2: Host directory mount**

Mount a local directory for easier access:

```bash
# Create local directory
mkdir -p ./data

# Update compose.yaml backend service volumes section:
# volumes:
#   - ${KUBECONFIG:-$HOME/.kube/config}:/tmp/kubeconfig:ro
#   - ./data:/app/data
```

The database will be created at `./data/kubebeaver.db` on your host.

**Note:** Set `HISTORY_DB_PATH=data/kubebeaver.db` in `.env` (default, relative to `/app` in container). The path is relative to the mount point (`/app/data`), so `data/kubebeaver.db` resolves to `/app/data/kubebeaver.db` in the container.

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
| `HISTORY_DB_PATH` | SQLite path for analysis history (relative to backend dir or absolute) | `data/kubebeaver.db` |
| `REDIS_URL` | Redis URL for response cache (optional; leave empty to disable cache) | - |
| `CACHE_TTL_CONTEXTS` | Cache TTL for context list (seconds) | 60 |
| `CACHE_TTL_NAMESPACES` | Cache TTL for namespace list (seconds) | 60 |
| `CACHE_TTL_RESOURCES` | Cache TTL for resource list (seconds) | 30 |
| `CACHE_TTL_ANALYZE` | Cache TTL for analysis results (seconds) | 300 |

**Note on `HISTORY_DB_PATH`:** 
- In Docker: defaults to `/app/data/kubebeaver.db` (create a volume to persist)
- Locally: defaults to `backend/data/kubebeaver.db`
- Use an absolute path or mount a volume to persist history across container restarts

**Redis cache (optional):**  
Set `REDIS_URL=redis://localhost:6379/0` to cache API responses (contexts, namespaces, resources, and analysis results). Reduces repeated K8s API and LLM calls. If unset, no cache is used. With Docker Compose, a `redis` service is defined; set `REDIS_URL=redis://redis:6379/0` in `.env` and run `docker compose up -d redis backend frontend` to use it.

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

## License

See [LICENSE](LICENSE).
