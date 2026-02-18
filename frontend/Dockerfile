FROM node:20-alpine AS builder

LABEL org.opencontainers.image.title="KubeBeaver Frontend Builder" \
      org.opencontainers.image.description="Build stage for KubeBeaver frontend"

WORKDIR /app

# Copy package files and install dependencies (better caching)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts && \
    npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

FROM nginx:alpine

LABEL org.opencontainers.image.title="KubeBeaver Frontend" \
      org.opencontainers.image.description="KubeBeaver web UI" \
      org.opencontainers.image.version="0.1.0"

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy built assets and custom config
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Install curl for healthcheck and set permissions
# Note: nginx master process runs as root, workers as nginx user (default nginx:alpine behavior)
RUN apk add --no-cache curl && \
    chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
