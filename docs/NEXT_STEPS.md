# Hearth & Havoc next steps

Updated 2026-11-19.

The terminal-first interface is now the active UI direction. The next work
should strengthen the first playable loop before adding scale or social
features.

## Recommended order

### 1. Add the first quest vertical slice

Create versioned quest content and server-authoritative progress for the first
homestead quest:

- collect wood;
- forge iron nails;
- repair the homestead door;
- record completion and rewards.

Expose only the quest read model needed by Journal at first. Keep objectives,
progress, rewards, and completion validation on the backend. This gives the
Journal a real purpose and connects travel, gathering, crafting, and home
repair into one loop.

### 2. Implement crafting and homestead repair

Add the smallest useful commands and migrations for:

- a server-authoritative inventory/material model;
- forging nails from the actual available materials;
- repairing the door with validated requirements;
- idempotent receipts and optimistic concurrency.

Do not add a general crafting framework until the first recipe and repair flow
are working end to end.

### 3. Normalize terminal events

The backend already returns structured action/combat events, but the frontend
currently adapts them into session-local strings. Define a bounded terminal
event read model with a stable event ID, category, turn, and message data.
Decide whether history is save-scoped or session-scoped before persisting it;
include retention and pagination so the event log cannot grow without bound.

### 4. Complete the World Map presentation

Move the current hardcoded presentation coordinates into versioned map metadata
or a documented UI layout file. Preserve the existing route graph, distances,
and hidden-location behavior. Add discovered connections and an intentional
unknown/discovered/explored visibility model only after the underlying rules
are defined.

### 5. Add focused browser interaction coverage

Run browser tests for:

- terminal auto-travel and pause behavior;
- terminal scroll retention and jump-to-latest;
- Gamepad travel/gathering/combat actions;
- Encounter overlay open, action, resolution, and dismissal;
- World Map navigation;
- Journal quest list and detail selection;
- reload during active combat and after gathering.

The control host currently lacks Chromium system libraries, so browser tests
need to run in CI or on a browser-capable QA host until that is corrected.

### 6. Finish identity before shared deployment

Replace the development `X-Dev-User-ID` path with validated OIDC, Google login,
and save ownership. Do this before moving player data beyond local development.

### 7. Prepare production only after the vertical slice is coherent

Promote to `wbm-webprod-01` only after the first quest loop, auth boundary,
PostgreSQL migration path, backups/restore, TLS, observability, and failure
handling are validated. Production promotion requires the approved PR workflow.

## Explicitly not next

- WebSockets or microservices
- mandatory Qwen/LLM gameplay
- full fog-of-war simulation
- large-scale social systems
- a generalized item/crafting framework
- production deployment from the development branch
