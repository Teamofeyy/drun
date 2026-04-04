# InfraHub (MVP)

Центральный сервис принимает задачи, ставит их в **Redis**-очередь на агента, хранит результаты в **PostgreSQL**. **Агент** на Rust с **CLI (clap)** выполняет только заранее описанные сценарии (без произвольных команд). **UI** — React (Vite), JWT для панели, токен для агента.

## Архитектура

| Компонент | Описание |
|-----------|----------|
| `backend/` | Axum REST API, миграции sqlx |
| `agent/` | CLI: `register`, `run` (heartbeat + poll + проверки) |
| `frontend/` | React SPA: агенты, задачи, результаты |

## Типы задач (whitelist)

- `system_info` — hostname, ОС, интерфейсы (sysinfo)
- `port_check` — `payload`: `{ "targets": [{ "host", "port" }] }`
- `diagnostic` — `payload`: `{ "scenario": "uname" \| "hostname" \| "interfaces_summary" }`
- `network_reachability` — `payload`: `{ "targets": ["host:port", ...] }`

Сервер отклоняет неизвестные `kind`; агент исполняет только эти ветки в коде.

## Быстрый старт

### 1. Инфраструктура

```bash
docker compose up -d
```

Дождитесь готовности Postgres (healthcheck).

### 2. Бэкенд

```bash
cp .env.example backend/.env
cd backend
cargo run
```

По умолчанию слушает `http://127.0.0.1:8080`. При первом запуске создаётся пользователь из `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 3. Фронтенд

```bash
cd frontend
npm install
npm run dev
```

Откройте `http://127.0.0.1:5173`, войдите (`admin` / `admin` по умолчанию).

### 4. Регистрация агента

```bash
cd agent
cargo run -- register --server http://127.0.0.1:8080 --name "dev-1"
```

Сохраните выданный **token** (повторно не показывается в этой модели — токен только в ответе регистрации).

### 5. Запуск агента

```bash
cargo run -- run --server http://127.0.0.1:8080 --token "<token>" --heartbeat-secs 10
```

В UI создайте задачу для зарегистрированного агента; агент подхватит её из очереди.

## API (кратко)

| Метод | Путь | Auth |
|-------|------|------|
| POST | `/api/v1/auth/login` | — |
| POST | `/api/v1/agent/register` | — |
| POST | `/api/v1/agent/heartbeat` | Agent Bearer |
| GET | `/api/v1/agent/tasks/next` | Agent Bearer |
| POST | `/api/v1/agent/tasks/:id/complete` | Agent Bearer |
| POST | `/api/v1/agent/tasks/:id/fail` | Agent Bearer |
| GET | `/api/v1/agents` | JWT |
| GET/POST | `/api/v1/tasks` | JWT |
| GET | `/api/v1/tasks/:id`, `/result`, `/logs` | JWT |

## Ограничения MVP

- Один инстанс API; для продакшена понадобятся секреты, TLS, rate limits, аудит.
- Статус агентов: `online`, если heartbeat был не позже ~90 с (настраивается логикой в `list_agents`).
- Очередь: Redis list + резервный выбор из БД для `pending`.

## Tauri

Сейчас UI — обычный React SPA. Обёртка в Tauri — отдельный шаг: `npm create tauri-app` и подключение собранного `frontend/dist` как `frontendDist`.
