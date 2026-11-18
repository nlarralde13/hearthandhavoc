# Architecture decision record

## ADR-0001: Modular monolith first

**Status:** Accepted

Keep gameplay, API, persistence, and narrative integration in one repository
and deployable application. This minimizes coordination and operational cost
while preserving clear domain boundaries.

## ADR-0002: SQLite locally, PostgreSQL in shared environments

**Status:** Accepted

SQLite is the simplest useful local/test database. PostgreSQL is required for
the 3,000-concurrent-player target, multi-process API operation, public
leaderboards, and safer transactional behavior.

## ADR-0003: OIDC identity with Google login

**Status:** Accepted in principle

Use an OIDC-compatible identity boundary. The exact provider deployment is a
follow-up discovery item; self-hosted Authentik is the current candidate.

## ADR-0004: Version everything that affects saves

**Status:** Accepted

API contracts, database schemas, game definitions, and save formats receive
explicit versions. Compatibility changes require a documented migration or
rejection path.
