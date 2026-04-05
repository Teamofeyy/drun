# Build context = repo root (see docker-compose).
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM caddy:2.10-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/Caddyfile.internal /etc/caddy/Caddyfile.internal
COPY --from=build /app/dist /srv

EXPOSE 80
EXPOSE 443

CMD ["sh", "-c", "exec caddy run --config ${CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile} --adapter caddyfile"]
