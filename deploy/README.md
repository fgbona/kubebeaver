# Deploy KubeBeaver

## Docker Compose

From the repo root:

```bash
export KUBECONFIG=~/.kube/config
docker compose up --build
```

Frontend: http://localhost:8080  
Backend: http://localhost:8000  

## Kubernetes (in-cluster)

1. Build images and load into your cluster (e.g. kind):

   ```bash
   docker build -t kubebeaver-backend:latest ./backend
   docker build -t kubebeaver-frontend:latest ./frontend
   kind load docker-image kubebeaver-backend:latest kubebeaver-frontend:latest
   ```

2. Apply manifests (order matters):

   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/rbac.yaml
   kubectl apply -f k8s/backend-config.yaml
   kubectl apply -f k8s/backend-deployment.yaml
   kubectl apply -f k8s/frontend-deployment.yaml
   kubectl apply -f k8s/ingress.yaml
   ```

3. Configure LLM (ConfigMap `kubebeaver-config`) and API keys (Secret `kubebeaver-secrets`).

4. If not using Ingress, port-forward:

   ```bash
   kubectl port-forward -n kubebeaver svc/frontend 8080:80
   kubectl port-forward -n kubebeaver svc/backend 8000:8000
   ```

   Then open http://localhost:8080 (frontend nginx will proxy /api to backend when both are in the same namespace and backend service is named `backend`).

## RBAC

See `k8s/rbac.yaml`. The ServiceAccount `kubebeaver` is bound to ClusterRole `kubebeaver-reader`, which allows:

- get, list: namespaces, pods, pods/log, events, nodes, deployments, statefulsets, daemonsets, replicasets, jobs, cronjobs
- Optional: metrics.k8s.io pods and nodes (if metrics-server is installed)

This is read-only and least privilege for the collector pipeline.
