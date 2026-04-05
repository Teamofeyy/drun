# Контекст сборки — корень репозитория (docker compose / build-push context: .)
# В workspace Cargo.toml есть members: backend, agent — без COPY agent cargo падает.
FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY backend ./backend
COPY agent ./agent

RUN cargo build --release -p infrahub-backend -p infrahub-agent

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    openssh-client \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /opt/infrahub/ansible
COPY ansible/ ./
RUN uv sync --frozen --no-install-project

RUN mkdir -p /usr/local/lib/infrahub
COPY --from=builder /app/target/release/infrahub-backend /usr/local/bin/infrahub-backend
COPY --from=builder /app/target/release/infrahub-agent /usr/local/lib/infrahub/infrahub-agent

ENV BIND=0.0.0.0:8080
ENV INFRAHUB_ANSIBLE_DIR=/opt/infrahub/ansible
ENV INFRAHUB_AGENT_BINARY=/usr/local/lib/infrahub/infrahub-agent
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/health > /dev/null || exit 1

CMD ["infrahub-backend"]
