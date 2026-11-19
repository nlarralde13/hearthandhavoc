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
- **M3 complete:** versioned Western Road tutorial events, Goblin Highwayman
  interruption, Old Timberwood discovery, manual gathering, and logging mastery.
- **M4 complete:** Briarbrook arrival, authored Master Garrick Cobb dialogue,
  the first father-history revelation, and idempotent quest completion.
- **M5 complete:** bidirectional expedited travel, one persisted ambush roll,
  ambush combat interruption, and journey continuation.
- **M6 complete:** homestead storage, Iron Nail crafting, permanent front-door
  repair, milestone events, and the complete first-playable loop.
- **Next:** final MVP QA and the remaining auth/production-readiness work.

## Recommended order

### 1. Run end-to-end MVP QA

Exercise the complete new-player path through:

- character creation;
- stranger and Briarbrook conversations;
- normal and expedited travel;
- gathering, storage, nail crafting, and permanent door repair;
- refresh/reload checks at each persistence boundary.

Keep browser coverage on a browser-capable QA host because Chromium system
libraries are not installed on the control host.

### 2. Normalize terminal events

The backend already returns structured action/combat events, but the frontend
currently adapts them into session-local strings. Define a bounded terminal
event read model with a stable event ID, category, turn, and message data.
Decide whether history is save-scoped or session-scoped before persisting it;
include retention and pagination so the event log cannot grow without bound.

### 3. Complete the World Map presentation

Move the current hardcoded presentation coordinates into versioned map metadata
or a documented UI layout file. Preserve the existing route graph, distances,
and hidden-location behavior. Add discovered connections and an intentional
unknown/discovered/explored visibility model only after the underlying rules
are defined.

### 4. Add focused browser interaction coverage

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

### 5. Finish identity before shared deployment

Replace the development `X-Dev-User-ID` path with validated OIDC, Google login,
and save ownership. Do this before moving player data beyond local development.

### 6. Prepare production only after the vertical slice is coherent

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
