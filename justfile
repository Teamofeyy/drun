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
