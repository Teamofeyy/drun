# Start all services
dev:
  #!/bin/bash
  # Kill any existing processes first
  just --justfile {{justfile()}} stop 2>/dev/null || true

  just dev-front &
  just dev-back &
  just dev-agent &

# Start Frontend
dev-front:
  cd frontend && npm i && npm run dev

# Start Master
# Remote agent install (POST /api/v1/admin/provision-agent): на машине с backend нужны
# `ansible-playbook` (пакет ansible-core), OpenSSH client; для входа по паролю — `sshpass`.
# Опционально: INFRAHUB_AGENT_DOWNLOAD_URL — URL Linux-бинаря агента; INFRAHUB_ANSIBLE_DIR — путь к каталогу ansible в репозитории;
# INFRAHUB_PROVISION_TIMEOUT_SECS (по умолчанию 1800, clamp 60–7200).
dev-back:
  cd backend && cargo run

# Start Agent
dev-agent:
  cargo run -p infrahub-agent

# Stop all background processes
dev-kill:
  #!/bin/bash
  pkill -f "npm run dev" || true
  pkill -f "cargo run" || true
  pkill -f "infrahub-agent" || true

stats:
  cloc . --vcs=git --not-match-f='package-lock\.json'
