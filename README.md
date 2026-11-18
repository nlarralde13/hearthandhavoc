# Hearth & Havoc

Hearth & Havoc is a browser-first, single-player fantasy RPG and homestead
builder. The first release is a deterministic vertical slice: create a
Blacksmith, travel the Western Road, survive a goblin encounter, gather
resources, forge nails, and repair the homestead door.

## Development status

The repository is currently at M0/M1 foundation work. The initial implementation
will use a modular monolith:

- React + TypeScript frontend
- FastAPI + Pydantic backend
- SQLite for local development and tests
- PostgreSQL for shared/staging/production environments
- Versioned game data and database migrations
- Server-authoritative, idempotent game commands

Qwen integration is optional and will not be required for essential gameplay.

## Repository layout

```text
backend/       FastAPI application and domain rules
frontend/      React client
game_data/     Versioned canonical content definitions
tests/         Cross-cutting test fixtures and scenarios
docs/          Architecture and decision records
infra/         Deployment configuration after environment validation
```

## Local development

Create the Python environment and install development dependencies:

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

Start the API and frontend in separate terminals:

```bash
.venv/bin/uvicorn app.main:app --app-dir backend --reload --port 8000
cd frontend && npm install && npm run dev
```

Run database migrations before starting the API:

```bash
.venv/bin/alembic upgrade head
```

Validate canonical game content before starting work:

```bash
.venv/bin/python -m app.validate_content
```

The development frontend uses the temporary `X-Dev-User-ID` header in local
development. Shared and production environments require a validated OIDC
bearer token. Secrets belong in an untracked `.env` file or an approved runtime
secret store; never commit them.

## Working rules

Use feature branches and pull requests. Every gameplay mutation must be
validated by the backend, run atomically, and accept an idempotency key.
