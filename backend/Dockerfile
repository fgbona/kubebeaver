FROM python:3.11-slim

LABEL org.opencontainers.image.title="KubeBeaver Backend" \
      org.opencontainers.image.description="Kubernetes troubleshooting assistant API" \
      org.opencontainers.image.version="0.1.0"

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# Install dependencies first (better layer caching)
COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e . && \
    pip cache purge

# Copy application code
COPY app/ app/

# Create data directory for SQLite and set permissions
RUN mkdir -p /app/data && \
    chown -R appuser:appuser /app

USER appuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
