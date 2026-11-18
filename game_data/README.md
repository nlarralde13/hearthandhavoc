# Game data

This directory will contain canonical, versioned definitions for items,
enemies, skills, locations, routes, recipes, quests, and NPCs.

Definitions must have stable IDs and pass validation before the application
starts. Balance values are data, not unexplained constants in domain code.

Route definitions are served through a save-filtered API view. Undiscovered
location IDs and names must not be sent to the browser.

Enemy definitions contain combat parameters only; the combat engine remains the
authoritative implementation of resolution and rewards.
