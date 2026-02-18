# KubeBeaver Backend

FastAPI service that collects Kubernetes cluster signals and uses an LLM to produce diagnostics.

## Run locally

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Set `KUBECONFIG` to your kubeconfig path. Configure LLM via env vars (see root README).
