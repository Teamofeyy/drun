# Start all services
dev:
  #!/usr/bin/env bash
  set -euo pipefail

  just dev-kill || true

  export AGENT_ENROLLMENT_SECRET="${AGENT_ENROLLMENT_SECRET:-dev-enrollment-change-me}"
  export INFRAHUB_ENROLLMENT_SECRET="${INFRAHUB_ENROLLMENT_SECRET:-$AGENT_ENROLLMENT_SECRET}"

  cd frontend && npm i && npm run dev &
  cargo run -p infrahub-backend &
  cargo run -p infrahub-agent &

# Stop all background processes
dev-kill:
  pkill -f '[i]nfrahub-backend' || true
  pkill -f '[n]pm run dev' || true
  pkill -f '[c]argo run' || true
  pkill -f '[i]nfrahub-agent' || true

prod:
  #!/usr/bin/env bash
  set -euo pipefail

  just dev-kill || true

  export AGENT_ENROLLMENT_SECRET="${AGENT_ENROLLMENT_SECRET:-dev-enrollment-change-me}"
  export INFRAHUB_ENROLLMENT_SECRET="${INFRAHUB_ENROLLMENT_SECRET:-$AGENT_ENROLLMENT_SECRET}"

  cd frontend && npm i && npm run dev

  cargo build -p infrahub-backend --release
  cargo build -p infrahub-agent --release

  ./target/release/infrahub-backend
  ./target/release/infrahub-agent

stats:
  cloc . --vcs=git --not-match-f='package-lock\.json'
