# Start all services
dev:
  just dev-kill || true
  cd frontend && npm i && npm run dev &
  cargo run -p infrahub-backend &
  cargo run -p infrahub-agent &

# Stop all background processes
dev-kill:
  pkill -f '[i]nfrahub-backend' || true
  pkill -f '[n]pm run dev' || true
  pkill -f '[c]argo run' || true
  pkill -f '[i]nfrahub-agent' || true

stats:
  cloc . --vcs=git --not-match-f='package-lock\.json'
