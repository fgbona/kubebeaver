# KubeBeaver

KubeBeaver is an intelligent Kubernetes troubleshooting assistant. It collects cluster signals (events, describe, logs, status, and optional metrics), then uses an LLM to produce a **diagnosis**, **likely root causes**, **recommended actions**, and **suggested kubectl commands**.

## Product goal

You select a **namespace** and a **target** (Pod, Deployment, StatefulSet, or Node), click **Analyze**, and get:

- A short **summary** of what is happening
- **Likely root causes** with confidence and evidence references
- A **checklist of recommended actions**
- **Suggested kubectl commands** to validate or fix
- **Raw evidence** (sanitized) for transparency, with **jq-style JSON syntax highlighting** and preserved formatting for easier debugging
- **Usage metrics**: tokens consumed and response time displayed in the UI

## Key features

- **Automatic data collection**: Gathers pod/Deployment/StatefulSet/Node details, events, logs, and status
- **LLM-powered analysis**: Uses Groq or OpenAI-compatible APIs to generate intelligent diagnostics
- **Security**: Automatic sanitization of secrets, tokens, and sensitive data before sending to LLM
- **Analysis history**: SQLite database (default) or MySQL/Postgres stores all analyses for review and comparison
- **Performance metrics**: Tracks token usage and response time for each analysis
- **Multi-context support**: Works with multiple Kubernetes contexts
- **In-cluster deployment**: Can run inside Kubernetes with RBAC for least-privilege access
- **Cluster health scan**: On-demand namespace or cluster-wide scan for failure signals (failing pods, replica mismatches, node pressure) with prioritized findings, **colored severity** (Critical/High/Medium/Low/Info), **per-finding timestamps** (when the issue occurred), and suggested kubectl commands
- **Evidence formatting**: When "Include logs in evidence" is enabled, scan evidence (e.g. `pod_logs`) is **pretty-printed and syntax-highlighted** (jq-style) in the UI for easier debugging
- **Compare two analyses**: Select two analyses from History and run **Compare** to get a deterministic diff (pod phase, container restarts, lastState, events, analysis summary) and an LLM-generated engineer-friendly explanation; side-by-side metadata and copy kubectl commands from both runs
- **Incident mode**: Group analyses and scans into **incidents** with a timeline; add notes; export as Markdown or JSON (deterministic, reproducible)
- **Scheduled scans**: Create **scan schedules** (cron) for namespace or cluster; built-in APScheduler runs scans and stores results (no Redis required). Optional **notifications**: set `WEBHOOK_URL` and/or `SLACK_WEBHOOK_URL` to receive a concise message on critical/high findings (counts, top 3 findings, link to scan when `BASE_URL` is set).

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
- ✅ **Colored severity** in scan summary and finding list (Critical=red, High=orange, Medium=yellow, Low=blue, Info=gray)
- ✅ **Issue timestamps** in scan findings (when each finding occurred, from pod/node evidence; falls back to scan time when not available)
- ✅ **jq-style JSON highlighting** for Raw evidence (Analyze) and Evidence (Scan), with pretty-printing when evidence includes logs
- ✅ **MySQL/Postgres + Alembic**: Optional external DB with migrations; SQLite remains the default
- ✅ **Compare two analyses**: Select two from History → Compare; deterministic diff (pod/container/events) + LLM explanation; side-by-side metadata and copy kubectl commands
- ✅ **Incidents**: Create incidents, add analyses/scans from history, add notes, view timeline, export Markdown/JSON
- ✅ **Scheduled scans**: CRUD schedules (cron), APScheduler runs scans and stores results; optional webhook/Slack on critical/high

### Next (v2.0 - Q2 2026)

See [Milestone v2.0.0-alpha], [Milestone v2.0.0-beta], [Milestone v2.0.0-rc] for planned features:

- [ ] **Heuristics Engine**: Additional deterministic checks (current scan covers CrashLoopBackOff, ImagePullBackOff, replica mismatch, node pressure)
- [x] **Comparison**: Compare two analyses side-by-side (what changed and why) — implemented in Sprint 3
- [x] **Incidents**: Group analyses/scans into incidents with timeline and export — implemented in Sprint 4
- [x] **Scheduled Scans**: Automated health checks via cron schedules (Sprint 5)
- [x] **Webhooks**: Optional WEBHOOK_URL and SLACK_WEBHOOK_URL on critical/high findings (Sprint 5)
- [ ] **Export**: JSON, Markdown, and PDF export for incidents and analyses
- [ ] **MySQL/Postgres hardening**: Additional migrations and tooling (Alembic and optional MySQL/Postgres are already supported)

### Later (v2.1+)

- [ ] **Multi-Cluster**: Scan and aggregate findings across multiple clusters
- [ ] **Custom Heuristics**: User-defined rules (YAML/JSON)
- [ ] **Advanced Metrics**: Cost tracking, performance analytics, Grafana dashboards
- [ ] **RBAC**: Fine-grained permissions (who can scan what)
- [ ] **API Keys**: Per-user API keys for programmatic access
- [ ] **Trend Analysis**: Resource health over time (requires time-series DB)

**Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved. We welcome contributions to any roadmap item.

## Releases and changelog

Releases use [standard-version](https://github.com/conventional-changelog/standard-version) and [Conventional Commits](https://www.conventionalcommits.org/) so the changelog and GitHub release notes are generated from commits (and PR titles). Use these prefixes so your changes appear in the right section:

| Prefix   | Section in changelog | Example |
|----------|----------------------|--------|
| `feat:`  | Features             | `feat: add cluster health scan` |
| `fix:`   | Bug Fixes            | `fix: lint on JSON in frontend` |
| `docs:`  | Documentation       | `docs: update README` |
| `refactor:` | Code Refactoring  | `refactor: simplify scanner` |
| `perf:`  | Performance         | `perf: cache namespace list` |

Works for both Node (frontend) and Python (backend). When you run the release script (e.g. `npm run release` or `npm run release -- patch`), it runs `standard-version`, which bumps the version and updates `CHANGELOG.md` from these commits. To use only the current version's notes as the release body, run `npm run release:notes` and pass the output to your release tool. Use **`npm run version:current --silent`** (or `node scripts/version.js`) for the version—it reads from the repo root so it works even if your release script later changes directory (e.g. to `backend/`). Example: `gh release create v$(npm run version:current --silent) --notes-file <(npm run release:notes --silent)`. Run `npm install` in the repo root so the devDependency `standard-version` is available.

**Script `ship`:** Like in [elaborall](https://github.com/fgbona/elaborall) (and similar apps), `npm run ship` is wired to an external script at `/usr/local/bin/release`. That script can run `standard-version`, then create the GitHub release with curated notes. **Importante:** para obter a versão e as notas, usa sempre a partir da **raiz do repo** (antes de qualquer `cd`): `npm run version:current --silent` e `npm run release:notes --silent`. Se o script fizer `cd` para outro dir (ex.: `backend/`), `require('./package.json')` falha; por isso existe `scripts/version.js`, que resolve o `package.json` pela raiz.

### Release notes ricas de uma vez por todas

Para que o GitHub release saia com **texto completo** (bullets, API, frontend) em vez de uma linha só do commit:

1. **Antes de criar o release**, crie o ficheiro **`scripts/release-notes-current.txt`** com o markdown que quiser no corpo do release (sem cabeçalho de versão; o GitHub já mostra a tag).
2. Gere o release com:  
   `gh release create v$(npm run version:current --silent) --notes-file <(npm run release:notes --silent)`  
   (usa `version:current` para obter a versão a partir da raiz do repo, mesmo que o script faça `cd` para outro dir). Ou usa `npm run ship` se o teu script invocar `release:notes`.
3. O `extract-release-notes.js` **usa esse ficheiro em vez do CHANGELOG** quando existe e não está vazio. Depois do release podes apagar ou esvaziar o ficheiro para a próxima vez usar o CHANGELOG outra vez.

Assim não precisas de editar o `CHANGELOG.md` (que pode estar protegido por hook) e manténs um único fluxo: **release-notes-current.txt** = corpo do release.

**Exemplo para v1.3.0** (colar em `scripts/release-notes-current.txt` antes de criar o release v1.3.0):

```markdown
### Features

* **Scheduled scans + notifications**
  * Backend: table `scan_schedules` (context, scope, namespace, cron, enabled); Alembic migration
  * Scheduler: APScheduler runs scans at cron and stores results (no Redis)
  * Notifications: optional `WEBHOOK_URL` and `SLACK_WEBHOOK_URL`; on critical/high findings send counts, top 3 findings, and scan link when `BASE_URL` is set
  * API: CRUD `POST/GET/PUT/DELETE /api/schedules`
  * Frontend: **Schedules** tab — create/edit/delete schedules, cron and enabled toggle
  * Repository tests for schedule CRUD
```

**Exemplo para v1.2.0** (referência):

```markdown
### Features

* **Incident Mode** — group analyses and scans into incidents with a timeline and export
  * Backend: entities `incidents`, `incident_items`, `incident_notes`; Alembic migration
  * API: `POST /api/incidents`, `POST /api/incidents/{id}/add`, `GET /api/incidents`, `GET /api/incidents/{id}` (timeline), `POST /api/incidents/{id}/export`, `POST /api/incidents/{id}/notes`
  * Frontend: **Incidents** tab — create incident, add analysis/scan from history, add notes, view timeline, export Markdown or JSON
  * Timeline: incident creation, items and notes ordered by `created_at`
  * Repository tests for incident CRUD and timeline
```

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

Use the **Scan** tab to run a cluster health scan: pick scope (namespace or cluster), select a namespace when scoping to one, optionally enable **Include logs in evidence**, then **Scan**. Results show a summary with **colored severity counts** (Critical/High/Medium/Low/Info), a filterable list of findings (each with a **timestamp** for when the issue occurred), and a detail panel with **formatted, syntax-highlighted evidence** and suggested kubectl commands when you click a finding.

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
| `MAX_COMPARE_CHARS` | Max characters sent to LLM for compare (diff + context) | 8000 |
| `ALEMBIC_DATABASE_URL` | Database URL for Alembic when running migrations on the host (e.g. `mysql+pymysql://...@localhost:33064/...`); used instead of `DATABASE_URL` so host can reach DB | - |

**Database:**  
By default, KubeBeaver uses SQLite (stored in `kubebeaver-history` volume). To use MySQL or Postgres, set `DATABASE_URL` in `.env`:
- MySQL: `mysql+aiomysql://user:password@host:3306/database`
- Postgres: `postgresql+asyncpg://user:password@host:5432/database`

MySQL is started by default with `docker compose up`. To use it, set `DATABASE_URL=mysql+aiomysql://kubebeaver:kubebeaver@mysql:3306/kubebeaver` in `.env`.

**Running Alembic migrations from the host:**  
If `DATABASE_URL` uses the Docker hostname `mysql`, that hostname does not resolve when you run `alembic upgrade head` on your machine. Set `ALEMBIC_DATABASE_URL` to the same URL with `localhost` and the host-exposed port (e.g. `33064`):  
`ALEMBIC_DATABASE_URL=mysql+pymysql://kubebeaver:kubebeaver@localhost:33064/kubebeaver`  
Then run: `cd backend && uv run alembic upgrade head`

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
- **POST /api/compare** – Body: `{ "analysis_id_a": "<uuid>", "analysis_id_b": "<uuid>" }`. Returns: `diff_summary` (markdown), `changes` (array of `{ type, path, before, after, impact }`), `likely_reasoning` (LLM explanation citing diff paths), `analysis_a` / `analysis_b` (metadata + `kubectl_commands`). Uses stored evidence and analysis_json; LLM payload is limited to diff + minimal context.
- **POST /api/scan** – Run cluster health scan. Body: `{ "context?", "scope": "namespace"|"cluster", "namespace?" (required when scope=namespace), "include_logs?" }`. Returns: `id`, `created_at`, `summary_markdown`, `error?`, `findings[]`, `counts` (by severity), `duration_ms?`.
- **GET /api/scans** – List recent scans (`?limit=50`).
- **GET /api/scans/{id}** – Get scan by id with full findings and summary. Each finding includes `occurred_at?` (ISO timestamp when the issue happened, from pod/node evidence) when available.
- **POST /api/incidents** – Create incident. Body: `{ "title", "description?", "severity?", "tags?" }`. Returns: `{ "id" }`.
- **POST /api/incidents/{id}/add** – Add analysis or scan to incident. Body: `{ "type": "analysis"|"scan", "ref_id": "<analysis_id|scan_id>" }`. Returns: `{ "id" }`.
- **GET /api/incidents** – List incidents (`?limit=50`).
- **GET /api/incidents/{id}** – Get incident with timeline (items + notes, sorted by `created_at`).
- **POST /api/incidents/{id}/export** – Export incident. Body: `{ "format": "markdown"|"json" }`. Returns: Markdown or JSON body (deterministic).
- **POST /api/incidents/{id}/notes** – Add note. Body: `{ "content": "..." }`. Returns: `{ "id" }`.
- **POST /api/schedules** – Create schedule. Body: `{ "context?", "scope", "namespace?", "cron", "enabled?" }`. Returns: `{ "id" }`.
- **GET /api/schedules** – List schedules (`?limit=100`).
- **GET /api/schedules/{id}** – Get schedule by id.
- **PUT /api/schedules/{id}** – Update schedule (partial). Body: `{ "context?", "scope?", "namespace?", "cron?", "enabled?" }`.
- **DELETE /api/schedules/{id}** – Delete schedule (204).

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
5. **Get scan detail:** `curl -s http://localhost:8000/api/scans/<id> | jq` (replace `<id>` with a scan id from step 4). Expect `created_at`, `summary_markdown`, `findings[]` (each with `severity`, `category`, `title`, `description`, `affected_refs`, `suggested_commands`, `evidence_snippet?`, `occurred_at?`).
6. **Click a finding** in the UI: detail panel shows formatted, syntax-highlighted evidence (if collected) and suggested kubectl commands. When "Include logs in evidence" was used, `pod_logs` and other JSON evidence are pretty-printed and colored.

---

## How to verify (Compare)

1. **Have at least two analyses** in History (run Analyze on the same or different resources at different times).
2. **Open the Analyze tab** and scroll to **History**.
3. **Select two analyses** using the checkboxes (first selection = A, second = B).
4. **Click "Compare selected"**. The compare panel shows side-by-side metadata (Analysis A vs B), **Likely reasoning** (LLM), **Diff summary** (markdown), and **Copy kubectl commands** (from A and from B).
5. **API:** `curl -s -X POST http://localhost:8000/api/compare -H "Content-Type: application/json" -d '{"analysis_id_a":"<id1>","analysis_id_b":"<id2>"}' | jq`. Expect `diff_summary`, `changes[]`, `likely_reasoning`, `analysis_a`, `analysis_b`.

---

## How to verify (Incidents)

1. **Start the stack** and ensure you have at least one analysis or scan in history.
2. **Open Incidents tab:** Click **Incidents** in the header.
3. **Create incident:** Enter a title (e.g. "Production pod crash"), optional description and severity, click **Create incident**. The new incident is selected and the detail panel appears.
4. **Add from history:** In "Add from history", choose **Analysis** or **Scan**, select an item from the dropdown, click **Add**. The timeline updates with the new item.
5. **Add note:** Type a note (e.g. "Mitigated by scaling") and click **Add note**. Timeline shows the note.
6. **Export:** Click **Export Markdown** or **Export JSON**. A file downloads (e.g. `incident-<id-prefix>.md` or `.json`). Markdown contains title, description, severity, and a chronological timeline; JSON has the same structure in machine-readable form.
7. **API:**  
   - Create: `curl -s -X POST http://localhost:8000/api/incidents -H "Content-Type: application/json" -d '{"title":"Test"}' | jq` → `{ "id": "..." }`.  
   - Add item: `curl -s -X POST http://localhost:8000/api/incidents/<id>/add -H "Content-Type: application/json" -d '{"type":"analysis","ref_id":"<analysis_id>"}' | jq`.  
   - List: `curl -s http://localhost:8000/api/incidents | jq`.  
   - Get: `curl -s http://localhost:8000/api/incidents/<id> | jq` → `id`, `title`, `timeline[]`, `items[]`, `notes[]`.  
   - Export: `curl -s -X POST http://localhost:8000/api/incidents/<id>/export -H "Content-Type: application/json" -d '{"format":"markdown"}'` → Markdown body.

---

## How to verify (Schedules)

1. **Start the stack** (backend + frontend). Scheduler starts with the app; no Redis required.
2. **Open Schedules tab:** Click **Schedules** in the header.
3. **Create schedule:** Choose scope (Namespace or Cluster), select namespace if scope is Namespace, enter cron (e.g. `0 * * * *` for hourly), leave Enabled checked, click **Create schedule**. The new schedule appears in the list.
4. **Edit/Delete:** Click **Edit** on a schedule to change cron or enabled; **Save** or **Cancel**. Click **Delete** to remove (with confirmation).
5. **Runs:** At the next cron tick, the backend runs the scan and stores the result (visible under the Scan tab → Recent scans). Failures are logged without crashing the app.
6. **Notifications (optional):** Set `WEBHOOK_URL` and/or `SLACK_WEBHOOK_URL` and `BASE_URL` in the backend environment. When a scheduled scan has critical or high findings, the backend POSTs a concise message (counts by severity, top 3 findings, link to scan).
7. **API:**  
   - Create: `curl -s -X POST http://localhost:8000/api/schedules -H "Content-Type: application/json" -d '{"scope":"namespace","namespace":"default","cron":"0 * * * *"}' | jq` → `{ "id": "..." }`.  
   - List: `curl -s http://localhost:8000/api/schedules | jq`.  
   - Get: `curl -s http://localhost:8000/api/schedules/<id> | jq`.  
   - Update: `curl -s -X PUT http://localhost:8000/api/schedules/<id> -H "Content-Type: application/json" -d '{"enabled":false}' | jq`.  
   - Delete: `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8000/api/schedules/<id>` → 204.

---

## License

See [LICENSE](LICENSE).
