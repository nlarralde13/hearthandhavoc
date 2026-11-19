# Hearth & Havoc next steps

Updated 2026-11-19.

The terminal-first interface is now the active UI direction. The next work
should strengthen the first playable loop before adding scale or social
features.

## MVP 1.0 milestone status

- **M1 complete:** character creation, persisted Son of a Blacksmith profile,
  starting equipment, and the initial homestead floor plan.
- **M2 complete:** opening narrative, one-time Explore Grounds encounter,
  A Father's Shadow activation, and guided-adventure selection.
- **Next:** M3 guided Western Road travel with fixed tutorial events, the first
  combat encounter, Old Timberwood discovery, and manual gathering.

## Recommended order

### 1. Implement the guided adventure vertical slice

Extend the existing prologue with versioned content and server-authoritative
progress for:

- the 20-turn Western Road;
- the fixed stranger/tutorial route events;
- Goblin Highwayman combat;
- Old Timberwood discovery and gathering.

Keep route progress separate from global activity turns, and keep all rewards,
combat results, discoveries, and quest progress authoritative on the backend.

### 2. Add the homestead quest vertical slice

Create versioned quest content and server-authoritative progress for collecting
wood, forging iron nails, repairing the homestead door, and recording the
milestone. Expose only the quest read model needed by Journal at first.

### 3. Implement crafting and homestead repair

Add the smallest useful commands and migrations for:

- a server-authoritative inventory/material model;
- forging nails from the actual available materials;
- repairing the door with validated requirements;
- idempotent receipts and optimistic concurrency.

Do not add a general crafting framework until the first recipe and repair flow
are working end to end.

### 4. Normalize terminal events

The backend already returns structured action/combat events, but the frontend
currently adapts them into session-local strings. Define a bounded terminal
event read model with a stable event ID, category, turn, and message data.
Decide whether history is save-scoped or session-scoped before persisting it;
include retention and pagination so the event log cannot grow without bound.

### 5. Complete the World Map presentation

Move the current hardcoded presentation coordinates into versioned map metadata
or a documented UI layout file. Preserve the existing route graph, distances,
and hidden-location behavior. Add discovered connections and an intentional
unknown/discovered/explored visibility model only after the underlying rules
are defined.

### 6. Add focused browser interaction coverage

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

### 7. Finish identity before shared deployment

Replace the development `X-Dev-User-ID` path with validated OIDC, Google login,
and save ownership. Do this before moving player data beyond local development.

### 8. Prepare production only after the vertical slice is coherent

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
