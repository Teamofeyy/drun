# InfraHub (MVP)

Центральный сервис принимает задачи, ставит их в **Redis**-очередь на агента, хранит результаты в **PostgreSQL**. **Агент** на Rust с **CLI (clap)** выполняет только заранее описанные сценарии (без произвольных команд). **UI** — React (Vite), JWT для панели, токен для агента.

## Архитектура

| Компонент | Описание |
|-----------|----------|
| `backend/` | Axum REST API, миграции sqlx |
| `agent/` | Один бинарь: авто-регистрация, сохранение токена, heartbeat + poll |
| `frontend/` | React + TanStack Query: агенты, задачи, результаты |

## Типы задач (whitelist)

- `system_info` — hostname, **все IP**, интерфейсы с трафиком, **ОС/ядро/архитектура**, RAM/swap, **диски**, список CPU
- `port_check` — TCP к целям, **время соединения**, ошибка, **резолв DNS**
- `diagnostic` — сценарии: `uname`, `hostname`, `interfaces_summary`, **`memory_disks`**, **`cpu_load`**, **`dns_lookup`** (+ `host` в payload)
- `network_reachability` — TCP + **время**, **пример DNS**, ошибки
- **`check_bundle`** — шаблоны (только из кода агента): **`node_baseline`**, **`network_context`**, **`internal_services_check`**

Сервер отклоняет неизвестные `kind`; агент исполняет только эти ветки в коде.

### Платформа (дополнительно)

- **SSE** `GET /api/v1/stream/dashboard?token=<JWT>` — снимок агентов и задач ~каждые 2 с (UI подключается для live).
- **Метрики** `GET /api/v1/metrics/summary` — задачи за 24 ч по статусам, среднее время `done`, агенты online/total.
- **`max_retries`** при создании задачи (по умолчанию 2) — при ошибке агента задача снова в очередь, пока не исчерпан лимит.
- **`AGENT_MAX_CONCURRENT_TASKS`** (по умолчанию 1) — не выдавать новую задачу, пока у агента есть `running`.
- В **`task_results.summary`** сохраняется краткая строка от агента.

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

По умолчанию слушает `http://127.0.0.1:8080`. При первом запуске создаётся пользователь из `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Миграции применяются автоматически (`sqlx migrate`); при обновлении кода с уже существующей БД просто перезапустите бэкенд.

### 3. Фронтенд

```bash
cd frontend
npm install
npm run dev
```

Откройте `http://127.0.0.1:5173`, войдите (`admin` / `admin` по умолчанию).

### 4. Агент

Одна команда подключает к платформе: при **первом** запуске выполняется регистрация, токен пишется в файл (на Unix часто `~/.local/share/infrahub/agent.json`). Потом достаточно того же `--server`.

```bash
cd agent
cargo run -- --server http://127.0.0.1:8080
# опционально: --name my-host  (по умолчанию hostname)
# новый токен / другой сервер: --re-register
```

Переменные окружения: `INFRAHUB_SERVER`, `INFRAHUB_AGENT_NAME`, `INFRAHUB_DATA_DIR`, `INFRAHUB_HEARTBEAT_SECS`.

В UI создайте задачу — агент подхватит её из очереди.

## API (кратко)

| Метод | Путь | Auth |
|-------|------|------|
| POST | `/api/v1/auth/login` | — |
| POST | `/api/v1/agent/register` | — |
| POST | `/api/v1/agent/heartbeat` | Agent Bearer |
| GET | `/api/v1/agent/tasks/next` | Agent Bearer |
| POST | `/api/v1/agent/tasks/{id}/complete` | Agent Bearer |
| POST | `/api/v1/agent/tasks/{id}/fail` | Agent Bearer |
| GET | `/api/v1/agents` | JWT |
| GET/POST | `/api/v1/tasks` | JWT (POST: тело может содержать `max_retries`) |
| GET | `/api/v1/tasks/{id}`, `/result`, `/logs` | JWT |
| GET | `/api/v1/metrics/summary` | JWT |
| GET | `/api/v1/stream/dashboard?token=<JWT>` | токен в query (для EventSource) |

## Ограничения MVP

- Один инстанс API; для продакшена понадобятся секреты, TLS, rate limits, аудит.
- Статус агентов: `online`, если heartbeat был не позже ~90 с (настраивается логикой в `list_agents`).
- Очередь: Redis list + резервный выбор из БД для `pending`.

## Tauri

Сейчас UI — обычный React SPA. Обёртка в Tauri — отдельный шаг: `npm create tauri-app` и подключение собранного `frontend/dist` как `frontendDist`.
