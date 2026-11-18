# Hearth & Havoc UI redesign plan

The supplied `hearth&havoc-mockup.png` is the visual reference for the browser
game console. It is an art-direction reference, not a pixel-perfect target.

## Phase 1: console shell

- Add one centered, persistent console frame around the existing game view.
- Keep the current save loading, travel, gathering, combat, and reset handlers.
- Add a persistent status header using only data currently available to the API.
- Add an explicit command-bar integration point without fabricating conversation
  responses before a conversation API exists.
- Add contextual action definitions and a lower action panel.
- Add in-session Journal, World Map, Home, Character, and Inventory tabs with a
  single active state; use intentional empty states for data not implemented.

## Phase 2: home view

- Move the existing narrative, event log, route context, gathering, and combat
  into the console's scene, narrative, and context regions.
- Add scene artwork only after selecting a consistent asset pipeline.

## Phase 3: supporting panels and polish

- Replace empty states with real journal, character, and inventory read models.
- Refine responsive behavior, keyboard interaction, independent scrolling, and
  visual details at 1920x1080 and 1366x768.

The redesign must not add gameplay rules, reset saves, or change production
deployment behavior.
