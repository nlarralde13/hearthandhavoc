# Development World Graph Editor

The development-only editor is available at `/dev/world-editor` on VM108. It
does not replace the player-facing World Map and is not available when
`APP_ENV` is anything other than `development`.

## Data model

Canonical fixtures live in `game_data/world/maps/*.json`. A map contains:

- `id`, `name`, `schema_version`;
- optional `parent_map_id` and `parent_location_id` for nested maps;
- `nodes`, each with a stable ID, display name, extensible type, map ID,
  presentation position, description, discovery behavior, key-location flag,
  optional child map, and content-definition references;
- `connections`, each with source/destination node IDs, directionality,
  authoritative travel turns, discovery requirements, expedited-travel
  settings, optional narrative reference, and route waypoints.

Node positions are presentation-only. They never determine route distance,
discovery, or travel rules. The canonical `western_road` connection remains a
20-turn bidirectional connection with `old_timberwood` at route offset 6.

## Save behavior

The editor writes changes through the development API to
`WORLD_DATA_DIR/overrides/maps`. The VM108 Compose deployment maps that path to
the persistent `hearth_data` volume, while the checked-in fixtures remain
available as defaults. Saves use a temporary file and atomic replacement.

The API validates duplicate IDs, dangling references, invalid waypoint offsets,
negative travel costs, ambush probability bounds, parent-map references, and
hierarchy cycles. Unconnected locations are retained and returned as warnings.
Normal graph cycles are valid. Exported JSON can be reviewed and copied into
the canonical fixtures through the normal Git workflow.

The player-facing World Map reads the same definitions through a separate
save-scoped endpoint. That endpoint filters nodes and connections by the
player's persisted discovery state, marks the current node or in-transit route
progress, and never returns the full editor definition. The editor remains a
developer tool; the player map is presentation and navigation only.

## Editor controls

- Add locations from the left palette.
- Drag nodes on the grid; use Snap to grid, zoom, pan, and Fit view.
- Drag a node's blue connector handle onto another node to create a
  bidirectional connection.
- Select nodes or lines to edit their properties in the right inspector.
- Use New child map and the breadcrumb parent control for hierarchy.
- Save only after reviewing validation warnings; Export JSON creates a local
  reviewable definition.
