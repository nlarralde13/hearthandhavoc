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

## ADR-0005: Terminal-first browser interface

**Status:** Accepted

The primary gameplay screen is a single terminal-style console. Home displays
live narrative and system output, while specialist concerns have explicit
homes: routes on World Map, quests on Journal, character data on Character,
items on Inventory, and active combat in a temporary Encounter overlay.

This keeps the interface legible at the intended browser sizes and prevents
the frontend from presenting competing copies of the same game state. The
Gamepad remains contextual and may invoke only commands already validated by
the backend. The terminal is a presentation layer; it is not an authoritative
event store yet.

The visual direction is restrained retro medieval: matte charcoal/green
surfaces, parchment text, antique gold accents, readable monospace or
selective serif typography, minimal borders, and no eyebrow-label pattern
unless explicitly requested.
