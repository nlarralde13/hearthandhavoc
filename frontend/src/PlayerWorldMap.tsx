import { useEffect, useMemo, useState } from "react";

type PlayerNode = { id: string; name: string; type: string; position: { x: number; y: number }; description: string; visibility: string; child_map_id?: string | null };
type PlayerConnection = { id: string; source: string; destination: string; bidirectional: boolean; travel_turns: number; expedited_eligible: boolean; ambush_chance: number; waypoints: Array<{ location_id: string; route_offset: number }> };
type PlayerMap = { map_id: string; name: string; parent_map_id?: string | null; parent_location_id?: string | null; current_location_id?: string | null; nodes: PlayerNode[]; connections: PlayerConnection[]; travel: { in_transit: boolean; source?: string | null; destination?: string | null; completed_turns: number; total_turns: number; expedited_available: boolean; expedited_in_progress: boolean; expedited_ambush_pending: boolean } };

type Props = { saveId: string; stateVersion: number; adventureStarted: boolean; onAdvance: () => void; onExpedite: () => void; busy: boolean };
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const USER_KEY = "hearth-and-havoc-dev-user";
const WIDTH = 1200;
const HEIGHT = 720;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 76;

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { "X-Dev-User-ID": localStorage.getItem(USER_KEY) ?? "local-player" } });
  if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

function labelType(type: string): string { return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function PlayerWorldMap({ saveId, stateVersion, adventureStarted, onAdvance, onExpedite, busy }: Props) {
  const [mapId, setMapId] = useState("western_region");
  const [map, setMap] = useState<PlayerMap | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void request<PlayerMap>(`/api/v1/saves/${saveId}/world-map?map_id=${encodeURIComponent(mapId)}&state_version=${stateVersion}`)
      .then((loaded) => { if (active) { setMap(loaded); setError(null); } })
      .catch((requestError: Error) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [mapId, saveId, stateVersion]);

  const nodeById = useMemo(() => new Map((map?.nodes ?? []).map((node) => [node.id, node])), [map]);
  const selectedNode = map?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnection = map?.connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const currentNode = map?.nodes.find((node) => node.id === map.current_location_id) ?? null;

  function fitView() {
    if (!map || map.nodes.length === 0) return;
    const xs = map.nodes.map((node) => node.position.x);
    const ys = map.nodes.map((node) => node.position.y);
    const width = Math.max(...xs) - Math.min(...xs) + NODE_WIDTH + 120;
    const height = Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT + 120;
    setZoom(Math.max(.55, Math.min(1.2, Math.min(WIDTH / width, HEIGHT / height))));
    setPan({ x: Math.max(0, Math.min(...xs) - 60), y: Math.max(0, Math.min(...ys) - 60) });
  }

  function centerOnPlayer() {
    if (!map || !currentNode) return;
    setPan({ x: Math.max(0, currentNode.position.x - WIDTH / (2 * zoom) + NODE_WIDTH / 2), y: Math.max(0, currentNode.position.y - HEIGHT / (2 * zoom) + NODE_HEIGHT / 2) });
  }

  function selectNode(node: PlayerNode) {
    setSelectedNodeId(node.id); setSelectedConnectionId(null);
  }

  if (error) return <section className="player-map-view"><h2>World Map unavailable</h2><p className="muted">{error}</p></section>;
  if (!map) return <section className="player-map-view"><h2>Loading world map…</h2></section>;

  const transitSource = map.travel.source ? nodeById.get(map.travel.source) : null;
  const transitDestination = map.travel.destination ? nodeById.get(map.travel.destination) : null;
  const transitProgress = map.travel.total_turns ? map.travel.completed_turns / map.travel.total_turns : 0;
  const tokenX = transitSource && transitDestination ? transitSource.position.x + NODE_WIDTH / 2 + (transitDestination.position.x - transitSource.position.x) * transitProgress : null;
  const tokenY = transitSource && transitDestination ? transitSource.position.y + NODE_HEIGHT / 2 + (transitDestination.position.y - transitSource.position.y) * transitProgress : null;

  return <section className="player-map-view">
    <header className="player-map-header"><div><h2>{map.name}</h2><p>{map.parent_map_id ? `Inside ${map.parent_location_id ?? "location"}` : "Known routes and discovered locations"}</p></div><div className="player-map-controls"><button onClick={() => setZoom((value) => Math.min(2, value + .1))}>＋</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(.45, value - .1))}>−</button><button onClick={fitView}>Fit</button><button onClick={centerOnPlayer} disabled={!currentNode}>Center on player</button></div></header>
    {map.parent_map_id && <button className="map-breadcrumb" onClick={() => setMapId(map.parent_map_id!)}>← Return to {map.parent_map_id}</button>}
    <div className="player-map-layout"><div className="player-map-canvas-wrap"><svg className="player-map-canvas" viewBox={`${pan.x} ${pan.y} ${WIDTH / zoom} ${HEIGHT / zoom}`} aria-label="Connected world map">
      <defs><pattern id="player-map-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#4e4a3c" strokeWidth=".6" opacity=".35" /></pattern></defs><rect width={WIDTH} height={HEIGHT} fill="url(#player-map-grid)" />
      {map.connections.map((connection) => { const source = nodeById.get(connection.source); const destination = nodeById.get(connection.destination); if (!source || !destination) return null; return <line key={connection.id} className={`player-map-connection ${selectedConnectionId === connection.id ? "selected" : ""} ${connection.expedited_eligible ? "expedited" : ""}`} x1={source.position.x + NODE_WIDTH / 2} y1={source.position.y + NODE_HEIGHT / 2} x2={destination.position.x + NODE_WIDTH / 2} y2={destination.position.y + NODE_HEIGHT / 2} onClick={() => { setSelectedConnectionId(connection.id); setSelectedNodeId(null); }} />; })}
      {map.nodes.map((node) => <g key={node.id} className={`player-map-node ${node.visibility} ${node.id === map.current_location_id ? "current" : ""} ${node.id === selectedNodeId ? "selected" : ""}`} transform={`translate(${node.position.x},${node.position.y})`} tabIndex={0} role="button" aria-label={`Select ${node.name}`} onClick={() => selectNode(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectNode(node); }}><rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="2" /><text x="12" y="29">{node.name}</text><text className="player-node-type" x="12" y="51">{labelType(node.type)}</text>{node.id === map.current_location_id && <text className="player-node-you" x={NODE_WIDTH - 12} y="20" textAnchor="end">YOU</text>}</g>)}
      {tokenX !== null && tokenY !== null && <g className="player-token" transform={`translate(${tokenX},${tokenY})`}><circle r="13" /><text y="4" textAnchor="middle">●</text></g>}
    </svg>{map.travel.in_transit && <div className="travel-progress-readout">Western Road · {map.travel.completed_turns} of {map.travel.total_turns} turns · {Math.round(transitProgress * 100)}%</div>}</div>
      <aside className="player-map-inspector">{selectedConnection ? <><h3>{selectedConnection.id}</h3><p>{nodeById.get(selectedConnection.source)?.name} {selectedConnection.bidirectional ? "↔" : "→"} {nodeById.get(selectedConnection.destination)?.name}</p><dl><dt>Normal travel</dt><dd>{selectedConnection.travel_turns} turns</dd><dt>Route status</dt><dd>{map.travel.in_transit && map.travel.source === selectedConnection.source ? "In progress" : "Available"}</dd><dt>Expedited travel</dt><dd>{selectedConnection.expedited_eligible ? `${map.travel.expedited_available ? "Available" : "Locked"} · ${Math.round(selectedConnection.ambush_chance * 100)}% ambush` : "Not available"}</dd></dl>{selectedConnection.id === "western_road" && <><button className="map-travel-button" disabled={!adventureStarted || busy || !map.travel.in_transit && map.current_location_id === "briarbrook"} onClick={onAdvance}>{busy ? "Resolving…" : "Advance normal travel"}</button>{selectedConnection.expedited_eligible && <button className="map-travel-button" disabled={!map.travel.expedited_available || busy} onClick={onExpedite}>{busy ? "Resolving…" : "Start expedited travel"}</button>}</>}</> : selectedNode ? <><h3>{selectedNode.name}</h3><p className="map-node-status">{selectedNode.visibility} · {labelType(selectedNode.type)}</p><p className="muted">{selectedNode.description}</p>{selectedNode.child_map_id && <button onClick={() => setMapId(selectedNode.child_map_id!)}>Enter location</button>}</> : <><h3>Select a location</h3><p className="muted">Select a box or route to inspect known map information. Viewing the map never advances time.</p></>}</aside></div>
  </section>;
}
