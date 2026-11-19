import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorldEditor from "./WorldEditor";

type SaveState = {
  save_id: string;
  background_id: string;
  character_name: string;
  archetype_id: string;
  attributes: Record<string, number>;
  equipment: string[];
  homestead: HomesteadState;
  prologue: {
    stranger_met: boolean;
    quest_status: "inactive" | "offered" | "active" | "completed";
    adventure_started: boolean;
  };
  state_version: number;
  content_version: string;
  route_id: string;
  route_offset: number;
  discovered_locations: string[];
  resources: Record<string, number>;
};

type HomesteadState = {
  rooms: Array<{ id: string; type: string; condition: string; upgrades: { front_door: string } }>;
  front_door: string;
};

type ActionResponse = {
  action_id: string;
  state_version: number;
  replayed: boolean;
  events: Array<{ type: string; location_id?: string; offset?: number }>;
  state: SaveState;
};

type RouteMap = {
  route_id: string;
  display_name: string;
  length: number;
  current_offset: number;
  waypoints: Array<{
    offset: number;
    location_id: string | null;
    label: string;
    known: boolean;
  }>;
};

type CombatState = {
  encounter_id: string;
  enemy_id: string;
  turn: "player" | "enemy";
  status: "active" | "victory" | "defeat";
  round: number;
  action_index: number;
  player_hp: number;
  player_max_hp: number;
  enemy_hp: number;
  enemy_max_hp: number;
};

type CombatActionResponse = {
  events: Array<{ type: string; target?: string; amount?: number }>;
  state: CombatState;
};

type TabId = "journal" | "map" | "home" | "character" | "inventory";

type ActionDefinition = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  hint?: string;
  run?: () => void;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const USER_KEY = "hearth-and-havoc-dev-user";
const SAVE_KEY = "hearth-and-havoc-save-id";
const AUTO_TRAVEL_DELAY_SECONDS = 3;

function devUserId(): string {
  return localStorage.getItem(USER_KEY) ?? "local-player";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Dev-User-ID": devUserId(),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function actionId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `action-${Date.now()}`;
}

function eventClass(message: string): string {
  if (message.startsWith("SYSTEM")) return "system";
  if (message.startsWith("NARRATIVE")) return "narrative";
  if (message.includes("Discovered")) return "discovery";
  if (message.includes("wood") || message.includes("Wood")) return "resource";
  if (message.includes("goblin") || message.includes("damage") || message.includes("attack")) return "combat";
  if (message.includes("warning") || message.includes("failed")) return "warning";
  if (message.includes("Turn")) return "travel";
  return "normal";
}

function formatGameEvent(event: { type: string; location_id?: string; offset?: number; quest_id?: string }, turn: number): string {
  if (event.type === "stranger.appears") return "NARRATIVE // A mysterious stranger recognizes your family name.";
  if (event.type === "quest.offered") return "QUEST // A Father's Shadow is waiting for your answer.";
  if (event.type === "quest.accepted") return "QUEST // Accepted: A Father's Shadow. Briarbrook holds the next lead.";
  if (event.type === "adventure.started") return "SYSTEM // WESTERN ROAD GUIDANCE ACTIVE · DESTINATION BRIARBROOK";
  if (event.type === "location.discovered") return `[Turn ${event.offset ?? turn}] Discovered: ${event.location_id}.`;
  if (event.type === "travel.advanced") return `[Turn ${event.offset ?? turn}] You continue west along the old road.`;
  return `[Turn ${turn}] ${event.type.replace(/\./g, " ")}.`;
}

function HomesteadFloorPlan({ homestead }: { homestead: HomesteadState }) {
  const doorState = homestead.front_door === "repaired" ? "Repaired" : "Broken";
  return (
    <section className="homestead-console" aria-label="Inherited homestead">
      <div className="homestead-floorplan" role="img" aria-label={`Single-room shack, front door ${doorState.toLowerCase()}`}>
        <div className="homestead-room">
          <span className="room-label">MAIN ROOM</span>
          <span className={`room-door ${homestead.front_door}`} aria-hidden="true" />
        </div>
      </div>
      <div className="homestead-readout">
        <span>Inherited homestead</span>
        <strong>Single-room shack</strong>
        <small>Front Door: {doorState}</small>
      </div>
    </section>
  );
}

function GameApp() {
  const [state, setState] = useState<SaveState | null>(null);
  const [needsCreation, setNeedsCreation] = useState(false);
  const [characterName, setCharacterName] = useState("");
  const [selectedArchetype, setSelectedArchetype] = useState("son_of_blacksmith");
  const [routeMap, setRouteMap] = useState<RouteMap | null>(null);
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoTravel, setAutoTravel] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_TRAVEL_DELAY_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [command, setCommand] = useState("");
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [encounterOpen, setEncounterOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const terminalRef = useRef<HTMLOListElement | null>(null);
  const terminalNearBottom = useRef(true);

  const appendEvents = useCallback((messages: string[]) => {
    setEvents((current) => [...current, ...messages]);
  }, []);

  const loadSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const saveId = localStorage.getItem(SAVE_KEY);
      if (!saveId) {
        setNeedsCreation(true);
        return;
      }
      const loaded = await request<SaveState>(`/api/v1/saves/${saveId}/state`);
      setState(loaded);
      setNeedsCreation(false);
      setAutoTravel(loaded.prologue.adventure_started && loaded.route_offset < 20);
      setRouteMap(await request<RouteMap>(`/api/v1/saves/${loaded.save_id}/map`));
      setEvents([
        `SYSTEM // LINK RESTORED · SAVE ${loaded.save_id.slice(0, 8).toUpperCase()} RESUMED`,
        "SYSTEM // HOMESTEAD ONLINE · WESTERN ROAD AVAILABLE",
        "NARRATIVE // The damaged shack is behind you. The road west waits beyond the gate.",
      ]);
      try {
        const loadedCombat = await request<CombatState>(`/api/v1/saves/${loaded.save_id}/combat`);
        setCombat(loadedCombat);
        if (loadedCombat.status === "active") {
          setAutoTravel(false);
          setEncounterOpen(true);
        }
      } catch {
        setCombat(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load save.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function createCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!characterName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await request<SaveState>("/api/v1/saves", {
        method: "POST",
        body: JSON.stringify({
          background_id: "blacksmith",
          character_name: characterName.trim(),
          archetype_id: selectedArchetype,
        }),
      });
      localStorage.setItem(SAVE_KEY, created.save_id);
      setState(created);
      setRouteMap(await request<RouteMap>(`/api/v1/saves/${created.save_id}/map`));
      setNeedsCreation(false);
      setEvents([
        `SYSTEM // NEW ADVENTURE INITIALIZED · ${created.character_name.toUpperCase()} ONLINE`,
        "SYSTEM // HOMESTEAD ONLINE · WESTERN ROAD AVAILABLE",
        "NARRATIVE // The King's letter granted you a battered homestead and a name worth carrying forward.",
        "NARRATIVE // The damaged shack is behind you. The road west waits beyond the gate.",
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create character.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadSave();
  }, [loadSave]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (terminalNearBottom.current) terminal.scrollTop = terminal.scrollHeight;
    else setShowJumpToLatest(true);
  }, [events]);

  const routeProgress = useMemo(() => {
    if (!state) return 0;
    return Math.round((state.route_offset / (routeMap?.length ?? 20)) * 100);
  }, [routeMap, state]);

  const advanceTravel = useCallback(async () => {
    if (!state || busy || !state.prologue.adventure_started || state.route_offset >= (routeMap?.length ?? 20)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action_id: actionId(), action: "travel.advance", expected_state_version: state.state_version, payload: {} }),
      });
      setState(response.state);
      setRouteMap(await request<RouteMap>(`/api/v1/saves/${response.state.save_id}/map`));
      const foundSomething = response.events.some((event) => event.type !== "travel.advanced");
      if (foundSomething || response.state.route_offset >= (routeMap?.length ?? 20)) setAutoTravel(false);
      appendEvents(response.events.map((event) => formatGameEvent(event, response.state.route_offset)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to advance travel.");
    } finally {
      setBusy(false);
    }
  }, [appendEvents, busy, routeMap?.length, state]);

  async function runPrologueAction(action: "homestead.explore" | "quest.accept" | "adventure.start") {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action_id: actionId(), action, expected_state_version: state.state_version, payload: {} }),
      });
      setState(response.state);
      appendEvents(response.events.map((event) => formatGameEvent(event, response.state.route_offset)));
      if (action === "adventure.start") setAutoTravel(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to resolve prologue action.");
    } finally {
      setBusy(false);
    }
  }

  async function gatherWood() {
    if (!state || busy || !state.discovered_locations.includes("old_timberwood")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action_id: actionId(), action: "gather.wood", expected_state_version: state.state_version, payload: { location_id: "old_timberwood" } }),
      });
      setState(response.state);
      appendEvents(`[Turn ${response.state.route_offset}] You collected 3 Wood from Old Timberwood.`.split("\n"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to gather wood.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoTravel || busy || !state || state.route_offset >= (routeMap?.length ?? 20)) return;
    setCountdown(AUTO_TRAVEL_DELAY_SECONDS);
    let remaining = AUTO_TRAVEL_DELAY_SECONDS;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        void advanceTravel();
        return;
      }
      setCountdown(remaining);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [advanceTravel, autoTravel, busy, routeMap?.length, state]);

  async function beginCombat() {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await request<CombatState>(`/api/v1/saves/${state.save_id}/combat`, { method: "POST", body: JSON.stringify({ enemy_id: "goblin" }) });
      setCombat(started);
      setAutoTravel(false);
      setEncounterOpen(true);
      appendEvents(`[Turn ${state.route_offset}] A goblin steps from the trees. It looks confident.`.split("\n"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start combat.");
    } finally {
      setBusy(false);
    }
  }

  async function combatAction(action: "attack" | "defend") {
    if (!state || !combat || busy || combat.status !== "active") return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<CombatActionResponse>(`/api/v1/saves/${state.save_id}/combat/actions`, {
        method: "POST",
        body: JSON.stringify({ action_id: actionId(), action, expected_action_index: combat.action_index }),
      });
      setCombat(response.state);
      const messages = response.events.map((event) => {
        if (event.type === "combat.victory") return `[Turn ${state.route_offset}] The goblin is defeated.`;
        if (event.type === "combat.defeat") return `[Turn ${state.route_offset}] You are defeated and wake at home.`;
        if (event.type === "combat.critical") return `[Turn ${state.route_offset}] Critical strike.`;
        if (event.type === "combat.damage") return `[Turn ${state.route_offset}] ${event.target === "player" ? "You take" : "The goblin takes"} ${event.amount} damage.`;
        if (event.type === "combat.player.defend") return `[Turn ${state.route_offset}] You brace behind your battered shield.`;
        if (event.type === "combat.defend.reduced_damage") return `[Turn ${state.route_offset}] Your guard absorbs part of the blow.`;
        if (event.type === "combat.enemy.attack") return `[Turn ${state.route_offset}] The goblin attacks.`;
        return `[Turn ${state.route_offset}] ${action === "attack" ? "You attack the goblin." : "You steady yourself."}`;
      });
      appendEvents(messages);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to resolve combat action.");
    } finally {
      setBusy(false);
    }
  }

  async function resetProgress() {
    if (!window.confirm("Start a new adventure? Your current browser progress will be replaced.")) return;
    setAutoTravel(false);
    setState(null);
    setRouteMap(null);
    setCombat(null);
    setEncounterOpen(false);
    setEvents([]);
    localStorage.removeItem(SAVE_KEY);
    setNeedsCreation(true);
  }

  function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!command.trim()) return;
    setCommandNotice("Conversation is not connected yet. Your message was not sent.");
  }

  function handleTerminalScroll() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 48;
    terminalNearBottom.current = nearBottom;
    if (nearBottom) setShowJumpToLatest(false);
  }

  function jumpToLatest() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminalNearBottom.current = true;
    terminal.scrollTo({ top: terminal.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
  }

  const navigation: Array<{ id: TabId; label: string; icon: string }> = [
    { id: "journal", label: "Journal", icon: "▤" },
    { id: "map", label: "World Map", icon: "✧" },
    { id: "home", label: "Home", icon: "⌂" },
    { id: "character", label: "Character", icon: "♙" },
    { id: "inventory", label: "Inventory", icon: "▣" },
  ];

  const actions: ActionDefinition[] = combat?.status === "active"
    ? []
    : [
        ...(!state?.prologue.stranger_met ? [{ id: "explore", label: "Explore Grounds", icon: "⌖", enabled: Boolean(state) && !busy, run: () => void runPrologueAction("homestead.explore") }] : []),
        ...(state?.prologue.quest_status === "offered" ? [{ id: "accept", label: "Accept Quest", icon: "✦", enabled: !busy, run: () => void runPrologueAction("quest.accept") }] : []),
        ...(state?.prologue.quest_status === "active" && !state.prologue.adventure_started ? [{ id: "adventure", label: "Head Out on Adventure", icon: "➜", enabled: !busy, run: () => void runPrologueAction("adventure.start") }] : []),
        ...(state?.prologue.adventure_started ? [{ id: "travel", label: "Advance", icon: "➜", enabled: Boolean(state) && !busy && state?.route_offset !== routeMap?.length, run: () => void advanceTravel() }] : []),
        { id: "gather", label: "Gather wood", icon: "❖", enabled: Boolean(state?.discovered_locations.includes("old_timberwood")) && !busy, hint: "Gather wood at Old Timberwood.", run: () => void gatherWood() },
        ...(state?.discovered_locations.includes("old_timberwood") && !combat ? [{ id: "encounter", label: "Face goblin", icon: "⚔", enabled: !busy, run: () => void beginCombat() }] : []),
        { id: "craft", label: "Craft", icon: "◆", enabled: false, hint: "Crafting is not implemented yet." },
      ];

  const knownWaypoints = routeMap?.waypoints.filter((waypoint) => waypoint.known) ?? [];

  if (needsCreation) {
    return (
      <main className="shell">
        <section className="game-console creation-console">
          <header className="masthead"><div><h1>Hearth <span>&amp;</span> Havoc</h1></div><div className="version">MVP 1.0 · new adventure</div></header>
          {error && <div className="notice error">{error}</div>}
          <form className="character-creation" onSubmit={(event) => void createCharacter(event)}>
            <div className="creation-heading"><p className="context-label">Character creation</p><h2>Choose your beginning</h2><p className="muted">The road is waiting. It has been waiting for some time, and is becoming insufferable about it.</p></div>
            <label className="name-field">Character name<input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="Enter a name" maxLength={80} required autoFocus /></label>
            <div className="archetype-grid" aria-label="Starting archetypes">
              <button type="button" className={`archetype-card ${selectedArchetype === "son_of_blacksmith" ? "selected" : ""}`} onClick={() => setSelectedArchetype("son_of_blacksmith")}>
                <span className="archetype-status">Playable</span><strong>Son of a Blacksmith</strong><span>Strong hands, a battered inheritance, and a practical relationship with fire.</span><small>Might 14 · Agility 8 · Endurance 10 · Intellect 8</small>
              </button>
              <button type="button" className="archetype-card disabled" disabled><span className="archetype-status">Coming soon</span><strong>Child of a Farmhand</strong><span>A life of weather, soil, and sturdy opinions.</span></button>
              <button type="button" className="archetype-card disabled" disabled><span className="archetype-status">Coming soon</span><strong>Apprentice Scholar</strong><span>Questions, ink stains, and an alarming number of books.</span></button>
            </div>
            <div className="creation-footer"><p className="muted">Starting equipment: Forge Hammer · Nailed Scrap Board · Blacksmith's Apron</p><button className="primary-button" type="submit" disabled={busy || !characterName.trim()}>Enter the world</button></div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="game-console">
        <header className="masthead">
          <div><h1>Hearth <span>&amp;</span> Havoc</h1></div>
          <div className="masthead-actions"><div className="version">content {state?.content_version ?? "—"}</div><button className="reset-button" onClick={() => void resetProgress()} disabled={busy}>Reset progress</button></div>
        </header>

        {error && <div className="notice error">{error}</div>}

        <section className="character-strip" aria-label="Character status">
          <div className="character-identity"><span className="crest">♜</span><div><strong>{state?.character_name ?? "Blacksmith"}</strong><small>Son of a Blacksmith · turn {state?.route_offset ?? "—"}</small></div></div>
          <div className="status-metric"><span>HP</span><strong>— / —</strong><small>not modeled</small></div>
          <div className="status-metric"><span>Stamina</span><strong>—</strong><small>not modeled</small></div>
          <div className="status-metric"><span>Wood</span><strong>{state?.resources.wood ?? 0}</strong><small>carried</small></div>
          <div className="status-metric"><span>Turn</span><strong data-testid="adventure-turn">{state?.route_offset ?? "—"} / {routeMap?.length ?? 20}</strong><small>western road</small></div>
          <div className="status-metric"><span>State</span><strong>v{state?.state_version ?? "—"}</strong><small>saved</small></div>
        </section>

        <section className={`console-content ${activeTab === "home" ? "home-console-surface" : ""}`}>
          {activeTab === "home" && <>
            <header className="terminal-context"><div><p className="context-label">Home terminal · Western Road</p><h2>Adventure channel</h2><p className="muted">The world is listening. Type a command or choose an action below.</p></div><span className="terminal-state">{autoTravel ? `AUTO ${countdown}s` : "PAUSED"}</span></header>
            {state?.homestead && <HomesteadFloorPlan homestead={state.homestead} />}
            <div className="terminal-window">
              <div className="terminal-banner">HEARTH &amp; HAVOC // LIVE WORLD FEED</div>
              <ol className="terminal-events" ref={terminalRef} onScroll={handleTerminalScroll} aria-live="polite">
                {events.map((event, index) => <li className={`terminal-event ${eventClass(event)}`} key={`${event}-${index}`}><span className="terminal-caret">›</span><span>{event}</span></li>)}
                {events.length === 0 && <li className="terminal-event system"><span className="terminal-caret">›</span><span>SYSTEM // Awaiting world state…</span></li>}
              </ol>
              {showJumpToLatest && <button className="jump-latest" onClick={jumpToLatest}>Jump to latest</button>}
            </div>
            <form className="command-bar" onSubmit={submitCommand}>
              <button type="button" className="command-mode">▰ Talk <span>⌄</span></button>
              <input value={command} onChange={(event) => { setCommand(event.target.value); setCommandNotice(null); }} placeholder="Type a message or command…" aria-label="Message or command" />
              <button className="send-button" type="submit" disabled={!command.trim()}>Send</button>
            </form>
            {commandNotice && <p className="command-notice">{commandNotice}</p>}
            <section className="action-panel gamepad" aria-label="Contextual actions">
              <div className="section-heading"><div><p className="context-label">Gamepad</p><h3>Available commands</h3></div><small>{autoTravel ? "The road advances on its own." : "Choose your next move."}</small></div>
              <div className="action-grid">{actions.map((action) => <button key={action.id} className="action-button" disabled={!action.enabled} title={action.hint} onClick={action.run}><span className="action-icon">{action.icon}</span><span>{action.label}</span></button>)}</div>
            </section>
          </>}

          {activeTab === "map" && <section className="map-view"><div className="view-heading"><p className="context-label">World navigation</p><h2>Western Road</h2><p className="muted">Known locations and the current route. Undiscovered waypoint identities remain hidden.</p></div><div className="map-grid" aria-label="Western Road grid map"><div className="map-route-line" />{[...Array(20)].map((_, index) => <span className={`map-cell ${index % 5 === 0 ? "terrain" : ""}`} key={index} />)}<div className="map-node home-node"><span>⌂</span><small>Shack</small></div>{knownWaypoints.map((waypoint) => <div className={`map-node waypoint-${waypoint.location_id}`} key={waypoint.location_id ?? waypoint.offset} data-testid={`map-waypoint-${waypoint.offset}`} style={{ left: `${Math.min(82, 12 + waypoint.offset * 3.4)}%`, top: waypoint.location_id === "briarbrook" ? "25%" : "63%" }}><span>◆</span><small>{waypoint.label}</small></div>)}</div><div className="map-readout"><strong>Current position</strong><span>Western Road · turn {state?.route_offset ?? 0} / {routeMap?.length ?? 20}</span></div></section>}
          {activeTab === "journal" && <section className="quest-journal"><div className="view-heading"><p className="context-label">Adventure ledger</p><h2>Quest Journal</h2><p className="muted">Track objectives, story threads, and contracts as the world begins to make demands.</p></div><div className="quest-layout"><aside className="quest-list"><div className="quest-list-heading">Active quests <small>{state?.prologue.quest_status === "active" ? 1 : 0}</small></div>{state?.prologue.quest_status === "active" ? <button className="quest-entry" type="button">A Father's Shadow</button> : <p className="ledger-empty">No quests have been recorded yet.</p>}<div className="quest-list-heading">Completed <small>0</small></div><p className="ledger-empty">The ledger is waiting for its first completed story.</p></aside><section className="quest-details"><p className="context-label">Selected quest</p>{state?.prologue.quest_status === "active" ? <><h3>A Father's Shadow</h3><p className="muted">A stranger claims the King's account of your father's service is incomplete. Travel to Briarbrook and find someone who remembers him.</p><p className="quest-objective">{state.prologue.adventure_started ? "▣ Travel to Briarbrook — adventure underway" : "□ Accept the guided adventure to Briarbrook"}</p></> : <><h3>No quest selected</h3><p className="muted">Quest objectives, lore, and rewards will appear here when quest definitions arrive.</p></>}</section></div></section>}
          {activeTab === "character" && <section className="panel-empty"><p className="context-label">Character</p><h2>A craftsperson on the road</h2><p className="muted">Attributes, mastery, equipment, and progression are not modeled in this vertical slice yet.</p></section>}
          {activeTab === "inventory" && <section className="panel-empty"><p className="context-label">Inventory</p><h2>Carried supplies</h2><p className="muted">Wood: {state?.resources.wood ?? 0}. Item slots and equipment will be added with crafting.</p></section>}
        </section>

        {encounterOpen && combat && <section className="encounter-overlay" role="dialog" aria-modal="false" aria-labelledby="encounter-title">
          <div className="encounter-header"><div><p className="context-label">Temporary encounter</p><h2 id="encounter-title">Goblin in the timber</h2></div><span className={`combat-status ${combat.status}`}>{combat.status}</span></div>
          <p className="muted">A goblin highwayman blocks the old road. The terminal waits for your move.</p>
          <div className="combat-bars"><div><span>You</span><strong>{combat.player_hp} / {combat.player_max_hp}</strong><div className="health-track"><i style={{ width: `${(combat.player_hp / combat.player_max_hp) * 100}%` }} /></div></div><div><span>Goblin</span><strong>{combat.enemy_hp} / {combat.enemy_max_hp}</strong><div className="health-track enemy"><i style={{ width: `${(combat.enemy_hp / combat.enemy_max_hp) * 100}%` }} /></div></div></div>
          {combat.status === "active" ? <div className="combat-actions">{["attack", "defend"].map((action) => <button className="action-button" key={action} onClick={() => void combatAction(action as "attack" | "defend")} disabled={busy || combat.turn !== "player"}>{action === "attack" ? "⚔ Attack" : "◇ Defend"}</button>)}</div> : <button className="secondary-button" onClick={() => setEncounterOpen(false)}>Return to terminal</button>}
        </section>}

        <nav className="bottom-navigation" aria-label="Game navigation">{navigation.map((item) => <button key={item.id} className={`nav-button ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</nav>
      </div>
    </main>
  );
}

export default function App() {
  if (window.location.pathname === "/dev/world-editor") {
    return <WorldEditor onExit={() => { window.location.href = "/"; }} />;
  }
  return <GameApp />;
}
