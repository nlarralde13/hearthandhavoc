import { useEffect, useMemo, useRef, useState } from "react";

type WorldNode = {
  id: string;
  name: string;
  type: string;
  map_id: string;
  parent_location_id?: string | null;
  position: { x: number; y: number };
  description: string;
  discovery: string;
  key_location: boolean;
  child_map_id?: string | null;
  content: Record<string, unknown>;
};

type WorldConnection = {
  id: string;
  source: string;
  destination: string;
  bidirectional: boolean;
  travel_turns: number;
  discovery_requirements: string[];
  expedited_travel: { eligible: boolean; ambush_chance: number };
  narrative_id?: string | null;
  waypoints: Array<{ location_id: string; route_offset: number }>;
};

type WorldMap = {
  schema_version: string;
  id: string;
  name: string;
  parent_map_id?: string | null;
  parent_location_id?: string | null;
  nodes: WorldNode[];
  connections: WorldConnection[];
};

type EditorProps = { onExit: () => void };

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const USER_KEY = "hearth-and-havoc-dev-user";
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const NODE_WIDTH = 170;
const NODE_HEIGHT = 72;

function userId(): string {
  return localStorage.getItem(USER_KEY) ?? "local-player";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Dev-User-ID": userId(), ...options.headers },
  });
  if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

function blankMap(id: string, name: string, parentMapId: string | null, parentLocationId: string | null): WorldMap {
  return { schema_version: "1.0.0", id, name, parent_map_id: parentMapId, parent_location_id: parentLocationId, nodes: [], connections: [] };
}

function nodeTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function WorldEditor({ onExit }: EditorProps) {
  const [maps, setMaps] = useState<WorldMap[]>([]);
  const [worldMap, setWorldMap] = useState<WorldMap | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [history, setHistory] = useState<WorldMap[]>([]);
  const [future, setFuture] = useState<WorldMap[]>([]);
  const [dirty, setDirty] = useState(false);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [status, setStatus] = useState("Loading world definitions…");
  const [error, setError] = useState<string | null>(null);
  const [fileImport, setFileImport] = useState<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const selectedNode = useMemo(() => worldMap?.nodes.find((node) => node.id === selectedNodeId) ?? null, [selectedNodeId, worldMap]);
  const selectedConnection = useMemo(() => worldMap?.connections.find((connection) => connection.id === selectedConnectionId) ?? null, [selectedConnectionId, worldMap]);

  useEffect(() => {
    void request<WorldMap[]>("/api/v1/dev/world/maps")
      .then((loaded) => {
        setMaps(loaded);
        const initial = loaded.find((item) => item.id === "western_region") ?? loaded[0];
        if (initial) setWorldMap(initial);
        setStatus(initial ? `Loaded ${initial.name}` : "No maps available");
      })
      .catch((requestError: Error) => { setError(requestError.message); setStatus("Unable to load maps"); });
  }, []);

  function commit(next: WorldMap) {
    if (!worldMap) return;
    setHistory((current) => [...current, worldMap]);
    setFuture([]);
    setWorldMap(next);
    setDirty(true);
    setError(null);
  }

  function selectMap(id: string) {
    const next = maps.find((item) => item.id === id);
    if (!next) return;
    if (dirty && !window.confirm("Discard unsaved map changes?")) return;
    setWorldMap(next);
    setSelectedNodeId(null);
    setSelectedConnectionId(null);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setStatus(`Loaded ${next.name}`);
  }

  function addNode(type: string) {
    if (!worldMap) return;
    const id = `${type}_${Date.now().toString(36)}`;
    const node: WorldNode = {
      id, name: `New ${nodeTypeLabel(type)}`, type, map_id: worldMap.id,
      position: { x: 500, y: 300 }, description: "", discovery: "on_visit", key_location: false, content: {},
    };
    commit({ ...worldMap, nodes: [...worldMap.nodes, node] });
    setSelectedNodeId(id);
    setSelectedConnectionId(null);
  }

  function updateNode(patch: Partial<WorldNode>) {
    if (!worldMap || !selectedNodeId) return;
    commit({ ...worldMap, nodes: worldMap.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node) });
  }

  function deleteNode() {
    if (!worldMap || !selectedNodeId || !window.confirm("Delete this location and its connections?")) return;
    commit({ ...worldMap, nodes: worldMap.nodes.filter((node) => node.id !== selectedNodeId), connections: worldMap.connections.filter((connection) => connection.source !== selectedNodeId && connection.destination !== selectedNodeId) });
    setSelectedNodeId(null);
  }

  function addConnection(source: string, destination: string) {
    if (!worldMap || source === destination || worldMap.connections.some((connection) => connection.source === source && connection.destination === destination)) return;
    const connection: WorldConnection = { id: `${source}_${destination}`, source, destination, bidirectional: true, travel_turns: 1, discovery_requirements: [], expedited_travel: { eligible: false, ambush_chance: 0 }, waypoints: [] };
    commit({ ...worldMap, connections: [...worldMap.connections, connection] });
    setSelectedConnectionId(connection.id);
    setSelectedNodeId(null);
    setConnectingFrom(null);
  }

  function updateConnection(patch: Partial<WorldConnection>) {
    if (!worldMap || !selectedConnectionId) return;
    commit({ ...worldMap, connections: worldMap.connections.map((connection) => connection.id === selectedConnectionId ? { ...connection, ...patch } : connection) });
  }

  function deleteConnection() {
    if (!worldMap || !selectedConnectionId || !window.confirm("Delete this connection?")) return;
    commit({ ...worldMap, connections: worldMap.connections.filter((connection) => connection.id !== selectedConnectionId) });
    setSelectedConnectionId(null);
  }

  function canvasPoint(event: { clientX: number; clientY: number }) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: pan.x + ((event.clientX - rect.left) / rect.width) * (CANVAS_WIDTH / zoom), y: pan.y + ((event.clientY - rect.top) / rect.height) * (CANVAS_HEIGHT / zoom) };
  }

  function moveNode(event: { clientX: number; clientY: number }) {
    if (!worldMap || !dragging) return;
    const point = canvasPoint(event);
    const raw = { x: Math.max(0, point.x - dragging.offsetX), y: Math.max(0, point.y - dragging.offsetY) };
    const position = snap ? { x: Math.round(raw.x / 20) * 20, y: Math.round(raw.y / 20) * 20 } : raw;
    setWorldMap({ ...worldMap, nodes: worldMap.nodes.map((node) => node.id === dragging.id ? { ...node, position } : node) });
    setDirty(true);
  }

  function fitView() {
    if (!worldMap || worldMap.nodes.length === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const xs = worldMap.nodes.map((node) => node.position.x);
    const ys = worldMap.nodes.map((node) => node.position.y);
    const width = Math.max(...xs) - Math.min(...xs) + NODE_WIDTH + 100;
    const height = Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT + 100;
    setZoom(Math.max(.5, Math.min(1.4, Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height))));
    setPan({ x: Math.max(0, Math.min(...xs) - 50), y: Math.max(0, Math.min(...ys) - 50) });
  }

  async function save() {
    if (!worldMap) return;
    setStatus("Validating and saving…");
    try {
      const result = await request<{ warnings: string[] }>(`/api/v1/dev/world/maps/${worldMap.id}`, { method: "PUT", body: JSON.stringify(worldMap) });
      setMaps((current) => current.some((item) => item.id === worldMap.id) ? current.map((item) => item.id === worldMap.id ? worldMap : item) : [...current, worldMap]);
      setDirty(false);
      setStatus(result.warnings.length ? `Saved with warning: ${result.warnings[0]}` : `Saved ${worldMap.name}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save map");
      setStatus("Save rejected");
    }
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!worldMap || !previous) return;
    setFuture((current) => [...current, worldMap]); setWorldMap(previous); setHistory((current) => current.slice(0, -1)); setDirty(true);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!worldMap || !next) return;
    setHistory((current) => [...current, worldMap]); setWorldMap(next); setFuture((current) => current.slice(0, -1)); setDirty(true);
  }

  function newMap() {
    const id = window.prompt("New map ID (lowercase, numbers, hyphens, underscores):", "new_map");
    if (!id || !/^[a-z0-9_-]+$/.test(id) || !worldMap) return;
    const next = blankMap(id, nodeTypeLabel(id), worldMap.id, selectedNodeId);
    setMaps((current) => [...current, next]); setWorldMap(next); setHistory([]); setFuture([]); setDirty(true); setSelectedNodeId(null); setStatus(`Created ${next.name}; save to persist it`);
  }

  function exportMap() {
    if (!worldMap) return;
    const blob = new Blob([JSON.stringify(worldMap, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${worldMap.id}.json`; link.click(); URL.revokeObjectURL(link.href);
  }

  function importMap(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as WorldMap;
        setWorldMap(imported); setMaps((current) => current.some((item) => item.id === imported.id) ? current : [...current, imported]); setSelectedNodeId(null); setSelectedConnectionId(null); setDirty(true); setStatus(`Imported ${imported.name}; save to validate`); setError(null);
      } catch { setError("The selected file is not valid JSON"); }
    };
    reader.readAsText(file);
  }

  if (!worldMap) return <main className="world-editor-loading">{error ?? status}</main>;
  const nodeById = new Map(worldMap.nodes.map((node) => [node.id, node]));

  return <main className="world-editor">
    <header className="world-editor-header"><div><h1>World Graph Editor</h1><p>Developer map authoring · {dirty ? "unsaved changes" : "saved"}</p></div><div className="editor-header-actions"><button onClick={onExit}>Exit editor</button><button onClick={undo} disabled={!history.length}>Undo</button><button onClick={redo} disabled={!future.length}>Redo</button><button onClick={exportMap}>Export JSON</button><button onClick={() => fileImport?.click()}>Import JSON</button><input ref={setFileImport} type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importMap(file); event.target.value = ""; }} /><button className="editor-save" onClick={() => void save()} disabled={!dirty}>Save map</button></div></header>
    <div className="world-editor-toolbar"><label>Map <select value={worldMap.id} onChange={(event) => selectMap(event.target.value)}>{maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label><button onClick={newMap}>New child map</button>{worldMap.parent_map_id && <button onClick={() => selectMap(worldMap.parent_map_id!)}>← Parent map</button>}<span className="editor-status">{status}</span>{error && <span className="editor-error">{error}</span>}</div>
    <div className="world-editor-layout">
      <aside className="editor-sidebar palette"><h2>Location palette</h2>{["settlement", "wilderness", "point_of_interest", "dungeon", "interior"].map((type) => <button key={type} onClick={() => addNode(type)}>＋ Add {nodeTypeLabel(type)}</button>)}<div className="palette-note">Drag a connector handle from one location to another to create a connection.</div></aside>
      <section className="editor-canvas-wrap"><div className="canvas-controls"><button onClick={() => setZoom((value) => Math.min(2, value + .1))}>＋</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(.4, value - .1))}>−</button><button onClick={fitView}>Fit view</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap to grid</label></div><svg ref={svgRef} className="world-canvas" viewBox={`${pan.x} ${pan.y} ${CANVAS_WIDTH / zoom} ${CANVAS_HEIGHT / zoom}`} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.4, Math.min(2, value - event.deltaY * .001))); }} onPointerDown={(event) => { if (event.target === event.currentTarget) setPanning({ x: pan.x, y: pan.y, clientX: event.clientX, clientY: event.clientY }); }} onPointerMove={(event) => { if (dragging) moveNode(event); else if (panning) setPan({ x: panning.x - (event.clientX - panning.clientX) / zoom, y: panning.y - (event.clientY - panning.clientY) / zoom }); }} onPointerUp={() => { setDragging(null); setPanning(null); }}>
          <defs><pattern id="editor-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8d8d0" strokeWidth=".5" opacity=".22" /></pattern><marker id="editor-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#69717a" /></marker></defs><rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#editor-grid)" />
          {worldMap.connections.map((connection) => { const source = nodeById.get(connection.source); const destination = nodeById.get(connection.destination); if (!source || !destination) return null; return <line key={connection.id} className={`editor-connection ${selectedConnectionId === connection.id ? "selected" : ""}`} x1={source.position.x + NODE_WIDTH / 2} y1={source.position.y + NODE_HEIGHT / 2} x2={destination.position.x + NODE_WIDTH / 2} y2={destination.position.y + NODE_HEIGHT / 2} markerEnd={connection.bidirectional ? undefined : "url(#editor-arrow)"} onPointerDown={(event) => { event.stopPropagation(); setSelectedConnectionId(connection.id); setSelectedNodeId(null); }} />; })}
          {worldMap.nodes.map((node) => <g key={node.id} className={`editor-node ${selectedNodeId === node.id ? "selected" : ""}`} transform={`translate(${node.position.x},${node.position.y})`} onPointerDown={(event) => { event.stopPropagation(); const point = canvasPoint(event); setSelectedNodeId(node.id); setSelectedConnectionId(null); setDragging({ id: node.id, offsetX: point.x - node.position.x, offsetY: point.y - node.position.y }); }} onPointerUp={(event) => { event.stopPropagation(); if (connectingFrom) addConnection(connectingFrom, node.id); setDragging(null); }}><rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="2" /><text x="12" y="25">{node.name.slice(0, 23)}</text><text className="node-type" x="12" y="46">{nodeTypeLabel(node.type)}</text><circle className="connector-handle" cx={NODE_WIDTH} cy={NODE_HEIGHT / 2} r="6" onPointerDown={(event) => { event.stopPropagation(); setConnectingFrom(node.id); }} /></g>)}
        </svg></section>
      <aside className="editor-sidebar inspector"><h2>Properties</h2>{selectedNode ? <><label>ID<input value={selectedNode.id} disabled /></label><label>Name<input value={selectedNode.name} onChange={(event) => updateNode({ name: event.target.value })} /></label><label>Type<select value={selectedNode.type} onChange={(event) => updateNode({ type: event.target.value })}>{["homestead", "settlement", "wilderness", "point_of_interest", "dungeon", "interior"].map((type) => <option key={type} value={type}>{nodeTypeLabel(type)}</option>)}</select></label><div className="inspector-row"><label>X<input type="number" value={selectedNode.position.x} onChange={(event) => updateNode({ position: { ...selectedNode.position, x: Number(event.target.value) } })} /></label><label>Y<input type="number" value={selectedNode.position.y} onChange={(event) => updateNode({ position: { ...selectedNode.position, y: Number(event.target.value) } })} /></label></div><label>Description<textarea value={selectedNode.description} onChange={(event) => updateNode({ description: event.target.value })} /></label><label>Discovery<select value={selectedNode.discovery} onChange={(event) => updateNode({ discovery: event.target.value })}><option value="on_visit">On visit</option><option value="starting_location">Starting location</option><option value="quest">Quest</option><option value="manual">Manual</option></select></label><label className="check-label"><input type="checkbox" checked={selectedNode.key_location} onChange={(event) => updateNode({ key_location: event.target.checked })} /> Key location</label>{selectedNode.child_map_id && <button onClick={() => selectMap(selectedNode.child_map_id!)}>Enter child map</button>}<button className="danger-button" onClick={deleteNode}>Delete location</button></> : selectedConnection ? <><label>ID<input value={selectedConnection.id} disabled /></label><label>Travel turns<input type="number" min="0" value={selectedConnection.travel_turns} onChange={(event) => updateConnection({ travel_turns: Number(event.target.value) })} /></label><label className="check-label"><input type="checkbox" checked={selectedConnection.bidirectional} onChange={(event) => updateConnection({ bidirectional: event.target.checked })} /> Bidirectional</label><label className="check-label"><input type="checkbox" checked={selectedConnection.expedited_travel.eligible} onChange={(event) => updateConnection({ expedited_travel: { ...selectedConnection.expedited_travel, eligible: event.target.checked } })} /> Expedited travel</label><label>Ambush probability<input type="number" min="0" max="1" step=".05" value={selectedConnection.expedited_travel.ambush_chance} onChange={(event) => updateConnection({ expedited_travel: { ...selectedConnection.expedited_travel, ambush_chance: Number(event.target.value) } })} /></label><button className="danger-button" onClick={deleteConnection}>Delete connection</button></> : <p className="inspector-empty">Select a location or connection to edit its properties.</p>}</aside>
    </div>
  </main>;
}
