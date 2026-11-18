# Hearth & Havoc architecture

## Boundary

The first release is a modular monolith. The browser submits intentions; the
backend validates and resolves them against authoritative state. The frontend
never owns dice, rewards, inventory quantities, timestamps, or progression.

## Runtime shape

```text
Browser -> TLS/reverse proxy -> stateless FastAPI application -> PostgreSQL
                                      |
                                      +-> versioned game data
                                      +-> OIDC identity provider
```

SQLite is used for local development and tests. PostgreSQL is required for
shared, staging, and production environments. The application must be safe to
run as multiple API processes without in-memory gameplay state.

Redis is optional infrastructure for a later measured need such as rate-limit
coordination, short-lived cache, or background work. It is not an MVP
dependency.

## Commands and persistence

Every state-changing command includes:

- authenticated user and save ID;
- stable action/idempotency ID;
- action name and validated payload;
- expected state version;
- server-controlled deterministic randomness.

Commands execute in one database transaction. A repeated action ID returns its
stored receipt. A stale state version returns a conflict requiring refresh.

Each save stores a private root seed and content/schema version. The root seed
is never sent to the client. Random results must be reproducible for debugging
and safe retry behavior.

## Identity and public APIs

Authentication uses OIDC with Google as an identity provider. The game stores
its own user identity and provider subject, not Google passwords. Authentik is
the preferred self-hosted candidate, subject to a separate discovery decision.

Public endpoints begin at `/api/v1/public/` and expose only sanitized,
paginated read models such as aggregate stats and leaderboards. They never
expose raw saves, email addresses, hidden content, or internal database IDs.

## Scale target

The design targets approximately 3,000 concurrent browser users by keeping API
processes stateless, using PostgreSQL transactions, limiting database pool
size, and serving frontend assets through a CDN or reverse proxy. Capacity is
not considered proven until realistic login, state-load, command, retry, and
leaderboard load tests pass.

## Security baseline

TLS, secure HttpOnly/SameSite cookies where applicable, CSRF protection,
strict CORS, request limits, rate limits, dependency/secret scanning, least
privilege service accounts, encrypted backups, and tested restores are required
before public production exposure.

## Deferred

WebSockets, microservices, autonomous NPCs, offline gathering, and mandatory
LLM inference are explicitly deferred until the vertical slice demonstrates a
need for them.
