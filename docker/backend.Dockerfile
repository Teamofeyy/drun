# Workspace root = build context (see docker-compose).
FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY backend ./backend

RUN cargo build --release -p infrahub-backend

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

ENV BIND=0.0.0.0:8080
ENV INFRAHUB_ANSIBLE_DIR=/opt/infrahub/ansible
EXPOSE 8080

CMD ["infrahub-backend"]
