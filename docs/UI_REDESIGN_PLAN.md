# Hearth & Havoc UI direction

Updated 2026-11-19.

The supplied `hearth&havoc-mockup.png` remains the visual reference for the
browser game console. It is an art-direction reference, not a pixel-perfect
target.

## Current direction: terminal-first game console

Hearth & Havoc is presented as a persistent medieval digital terminal rather
than a dashboard of simultaneous gameplay cards. The player should feel as if
they are entering an old world through a deliberate, self-aware interface:

- Home is one continuous event terminal for narrative, system messages, travel,
  discoveries, gathering, and combat results.
- The terminal uses readable retro typography, dark matte surfaces, parchment
  text, antique gold, muted green, restrained red, and blue-gray system text.
- There are no eyebrow labels in the interface unless explicitly requested.
- The console fits the browser viewport; the page itself should not require
  scrolling on normal desktop resolutions. Logs and specialist panels scroll
  internally where necessary.
- The contextual Gamepad is the only persistent command surface on Home.
- Encounter controls appear in a temporary overlay while combat is active.
- The World Map owns route presentation and geographic context.
- The Journal owns quests, objectives, lore, and story history; it is not a
  duplicate of the Home terminal.
- Character and Inventory own their respective summaries and future detail
  views.

## Screen responsibilities

| Screen | Owns | Does not own |
| --- | --- | --- |
| Home | live narrative terminal, system messages, current context, Gamepad | route cards, quest history, permanent encounter panels |
| World Map | region grid, known locations, roads, route progress, discovery context | combat controls, quest history |
| Journal | active/completed quests, objectives, lore, story history | live terminal transcript |
| Character | attributes, skills, mastery, equipment | travel or inventory mutations |
| Inventory | carried items, equipment, capacity/weight | route navigation or quest history |
| Encounter overlay | temporary combat state and combat actions | persistent navigation or automatic combat initiation |

The five persistent navigation destinations remain, in order:
`Journal | World Map | Home | Character | Inventory`. Home stays centered.
Switching destinations must not advance turns, mutate saves, or reset state.

## Current implementation status

- Terminal-first Home view is implemented.
- System and narrative bootstrap messages are shown when a save is created or
  resumed.
- Travel, discovery, gathering, and combat results are adapted into terminal
  messages.
- The terminal scrolls independently and offers a jump-to-latest control when
  the player is reading older output.
- World Map has a presentation-only grid with known route markers. It does not
  replace the authoritative route graph or add fog-of-war rules.
- Encounter state opens in a temporary overlay and remains dismissible after
  resolution.
- Journal is a quest-tracker view with intentional empty states until quest
  definitions and progress records exist.
- The Gamepad exposes only existing handlers; disabled commands do not mutate
  the backend.
- Terminal history is currently session-local. The backend does not yet expose
  a persisted event history, so reload restores save state plus bootstrap
  messages rather than the complete transcript.

## Future UI work

1. Add real quest definitions and progress read models, then populate Journal.
2. Replace hardcoded map presentation coordinates with versioned UI coordinates
   attached to canonical location content, without changing route distances.
3. Add a structured terminal-event adapter backed by authoritative event data so
   message formatting does not depend on reconstructing state from totals.
4. Add scene/location art only after the asset style and licensing path are
   decided.
5. Validate keyboard behavior, independent scrolling, mobile wrapping, and
   visual details at 1366x768 and 1920x1080 with a browser-capable test host.

The UI must not add gameplay rules, grant rewards, reset saves, or change
production deployment behavior.
