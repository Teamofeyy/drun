# Start all services
dev:
  just dev-kill || true

  just dev-front &
  just dev-back &
  just dev-agent &

# Start Frontend
dev-front:
  cd frontend && npm i && npm run dev

# Start Master
# Remote agent install (POST /api/v1/admin/provision-agent): ansible на машине с backend.
# Варианты: (1) `cd ansible && uv sync` — бинарь будет ansible/.venv/bin/ansible-playbook (подхватится автоматически);
# (2) INFRAHUB_ANSIBLE_USE_UV=1 и `uv run` из каталога с pyproject (INFRAHUB_UV_PROJECT_DIR, по умолчанию корень репо);
# (3) INFRAHUB_ANSIBLE_PLAYBOOK=/полный/путь/ansible-playbook.
# SSH по паролю: на controller обычно нужен `sshpass`.
# Бинарь для provision: соберите `cargo build -p infrahub-agent` (workspace target/debug|release/infrahub-agent) или задайте INFRAHUB_AGENT_BINARY.
# INFRAHUB_ANSIBLE_DIR — путь к каталогу ansible в репозитории;
# INFRAHUB_PROVISION_TIMEOUT_SECS (по умолчанию 1800, clamp 60–7200).
dev-back:
  # После добавления API-маршрутов нужен перезапуск именно из `cargo run`/`target/.../infrahub-backend`
  # со свежей сборкой, иначе новые пути (например provision-agent) дадут 404 на :8080.
  # Сборка агента нужна для POST /admin/provision-agent (копирование target/*/infrahub-agent).
  cargo run -p infrahub-backend

# Start Agent
dev-agent:
  cargo run -p infrahub-agent

# Stop all background processes
dev-kill:
  pkill -f "infrahub-backend" || true
  pkill -f "npm run dev" || true
  pkill -f "cargo run" || true
  pkill -f "infrahub-agent" || true

# Совместимость со старыми вызовами `just stop`
stop: dev-kill

stats:
  cloc . --vcs=git --not-match-f='package-lock\.json'