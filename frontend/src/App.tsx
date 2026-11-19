import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorldEditor from "./WorldEditor";
import PlayerWorldMap from "./PlayerWorldMap";
import HomesteadView from "./HomesteadView";

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
    briarbrook_contacted: boolean;
    father_lead_revealed: boolean;
    expedited_unlocked: boolean;
    expedited_journey: { status: string; source: string; destination: string; ambush: boolean } | null;
    homestead_repaired: boolean;
  };
  state_version: number;
  content_version: string;
  route_id: string;
  route_offset: number;
  discovered_locations: string[];
  resources: Record<string, number>;
  mastery: Record<string, number>;
};

type HomesteadState = {
  rooms: Array<{ id: string; type: string; condition: string; upgrades: { front_door: string } }>;
  front_door: string;
  storage?: Record<string, number>;
};

type ActionResponse = {
  action_id: string;
  state_version: number;
  replayed: boolean;
  events: Array<{ type: string; location_id?: string; offset?: number; skill?: string; amount?: number; quantity?: number; ore_used?: number; resource?: string; text?: string; speaker?: string; source?: string; destination?: string; ambush?: boolean; waypoint_offset?: number }>;
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
  save_state?: SaveState;
};

type TabId = "journal" | "map" | "console" | "character" | "inventory" | "homestead";

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

function formatGameEvent(event: { type: string; location_id?: string; offset?: number; quest_id?: string; skill?: string; amount?: number; quantity?: number; ore_used?: number; resource?: string; text?: string; speaker?: string; source?: string; destination?: string; ambush?: boolean }, turn: number): string {
  if (event.type === "stranger.appears") return "NARRATIVE // A mysterious stranger recognizes your family name.";
  if (event.type === "quest.offered") return "QUEST // A Father's Shadow is waiting for your answer.";
  if (event.type === "quest.accepted") return "QUEST // Accepted: A Father's Shadow. Briarbrook holds the next lead.";
  if (event.type === "npc.dialogue") return `DIALOGUE // ${event.speaker ? `${event.speaker}: ` : ""}${event.text ?? "Master Garrick studies you in silence."}`;
  if (event.type === "story.revelation") return `NARRATIVE // ${event.text ?? "The King's account was incomplete."}`;
  if (event.type === "quest.completed") return "QUEST // Completed: A Father's Shadow. The investigation has found its first true lead.";
  if (event.type === "adventure.started") return "SYSTEM // WESTERN ROAD GUIDANCE ACTIVE · DESTINATION BRIARBROOK";
  if (event.type === "tutorial.tracks") return "[Turn 3] You find unusual tracks crossing the road. Something is following the old route.";
  if (event.type === "tutorial.goblin") return "[Turn 5] A Goblin Highwayman blocks the Western Road.";
  if (event.type === "tutorial.landmark") return "[Turn 12] A weathered milestone marks the fork ahead. The road continues west.";
  if (event.type === "tutorial.merchant") return "[Turn 16] A traveling merchant waves from a creaking cart.";
  if (event.type === "route.arrived") return "[Turn 20] Briarbrook appears beyond the hedgerows. The Western Road is complete.";
  if (event.type === "travel.expedited") return `SYSTEM // EXPEDITED TRAVEL · ${event.source ?? "origin"} → ${event.destination ?? "destination"}${event.ambush ? " · AMBUSH" : " · SAFE JOURNEY"}`;
  if (event.type === "travel.ambush") return `[Travel] An ambush interrupts the expedited journey at the halfway waypoint.`;
  if (event.type === "travel.expedited.resumed") return `[Travel] You defeat the ambush and continue to ${event.destination ?? "your destination"}.`;
  if (event.type === "travel.expedited.defeated") return "[Warning] The ambush sends you back to the homestead.";
  if (event.type === "materials.deposited") return "SYSTEM // MATERIALS DEPOSITED · HOMESTEAD STORAGE UPDATED";
  if (event.type === "crafting.completed") return `[Crafting] Forged ${event.quantity ?? 0} Iron Nails. Consumed ${event.ore_used ?? 0} Iron Ore.`;
  if (event.type === "construction.completed") return "[Construction] You repair the front door. Used 10 Common Wood and 6 Iron Nails.";
  if (event.type === "milestone.completed") return "[Milestone] First Homestead Improvement Complete.";
  if (event.type === "gathering.completed") return `[Turn ${turn}] You collected ${event.amount ?? 0} Common Wood from Old Timberwood.`;
  if (event.type === "mastery.gained") return `[Mastery] ${event.skill ?? "Logging"} +${event.amount ?? 0} XP.`;
  if (event.type === "location.discovered") return `[Turn ${event.offset ?? turn}] Discovered: ${event.location_id}.`;
  if (event.type === "travel.advanced") return `[Turn ${event.offset ?? turn}] You continue west along the old road.`;
  return `[Turn ${turn}] ${event.type.replace(/\./g, " ")}.`;
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
  const [activeTab, setActiveTab] = useState<TabId>("console");
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
      if (response.events.some((event) => event.type === "combat.started")) {
        const activeCombat = await request<CombatState>(`/api/v1/saves/${response.state.save_id}/combat`);
        setCombat(activeCombat);
        setAutoTravel(false);
        setEncounterOpen(true);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to advance travel.");
    } finally {
      setBusy(false);
    }
  }, [appendEvents, busy, routeMap?.length, state]);

  async function runPrologueAction(action: "homestead.explore" | "quest.accept" | "adventure.start" | "npc.garrick.talk" | "travel.expedited" | "homestead.deposit" | "craft.iron_nails" | "homestead.repair_door", payload: Record<string, number> = {}) {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action_id: actionId(), action, expected_state_version: state.state_version, payload }),
      });
      setState(response.state);
      appendEvents(response.events.map((event) => formatGameEvent(event, response.state.route_offset)));
      if (action === "adventure.start") setAutoTravel(true);
      if (response.events.some((event) => event.type === "combat.started")) {
        const activeCombat = await request<CombatState>(`/api/v1/saves/${response.state.save_id}/combat`);
        setCombat(activeCombat);
        setAutoTravel(false);
        setEncounterOpen(true);
      }
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
      appendEvents(response.events.map((event) => formatGameEvent(event, response.state.route_offset)));
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
      if (response.save_state) setState(response.save_state);
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
    { id: "console", label: "Console", icon: "⌂" },
    { id: "character", label: "Character", icon: "♙" },
    { id: "inventory", label: "Inventory", icon: "▣" },
    { id: "homestead", label: "Homestead", icon: "⌂" },
  ];

  const storage = state?.homestead.storage ?? {};
  const woodOwned = (state?.resources.wood ?? 0) + (storage.wood ?? 0);
  const nailsOwned = (state?.resources.iron_nails ?? 0) + (storage.iron_nails ?? 0);
  const doorRepaired = state?.homestead.front_door === "repaired";

  const actions: ActionDefinition[] = combat?.status === "active"
    ? []
    : [
        ...(!state?.prologue.stranger_met ? [{ id: "explore", label: "Explore Grounds", icon: "⌖", enabled: Boolean(state) && !busy, run: () => void runPrologueAction("homestead.explore") }] : []),
        ...(state?.prologue.quest_status === "offered" ? [{ id: "accept", label: "Accept Quest", icon: "✦", enabled: !busy, run: () => void runPrologueAction("quest.accept") }] : []),
        ...(state?.prologue.quest_status === "active" && !state.prologue.adventure_started ? [{ id: "adventure", label: "Head Out on Adventure", icon: "➜", enabled: !busy, run: () => void runPrologueAction("adventure.start") }] : []),
        ...(state?.prologue.adventure_started ? [{ id: "travel", label: "Advance", icon: "➜", enabled: Boolean(state) && !busy && state?.route_offset !== routeMap?.length, run: () => void advanceTravel() }] : []),
        ...(state?.route_offset === routeMap?.length && state?.prologue.quest_status === "active" ? [{ id: "garrick", label: "Speak to Master Garrick", icon: "✦", enabled: !busy, run: () => void runPrologueAction("npc.garrick.talk") }] : []),
        ...((state?.prologue.expedited_unlocked || state?.discovered_locations.includes("briarbrook")) && (state.route_offset === 0 || state.route_offset === routeMap?.length) ? [{ id: "expedited", label: "Expedited Travel", icon: "≫", enabled: !busy, hint: "One action. Possible ambush.", run: () => void runPrologueAction("travel.expedited") }] : []),
        { id: "gather", label: "Gather wood", icon: "❖", enabled: Boolean(state?.discovered_locations.includes("old_timberwood")) && !busy, hint: "Gather wood at Old Timberwood.", run: () => void gatherWood() },
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

        <section className={`console-content ${activeTab === "console" ? "home-console-surface" : ""}`}>
          {activeTab === "console" && <>
            <header className="terminal-context"><div><p className="context-label">Game Console · Western Road</p><h2>Adventure channel</h2><p className="muted">The world is listening. Type a command or choose an action below.</p></div><span className="terminal-state">{autoTravel ? `AUTO ${countdown}s` : "PAUSED"}</span></header>
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

          {activeTab === "map" && state && <PlayerWorldMap saveId={state.save_id} stateVersion={state.state_version} adventureStarted={state.prologue.adventure_started} onAdvance={() => void advanceTravel()} onExpedite={() => void runPrologueAction("travel.expedited")} busy={busy} />}
          {activeTab === "journal" && <section className="quest-journal"><div className="view-heading"><p className="context-label">Adventure ledger</p><h2>Quest Journal</h2><p className="muted">Track objectives, story threads, and contracts as the world begins to make demands.</p></div><div className="quest-layout"><aside className="quest-list"><div className="quest-list-heading">Active quests <small>{(state?.prologue.quest_status === "active" ? 1 : 0) + (!doorRepaired ? 1 : 0)}</small></div>{state?.prologue.quest_status === "active" ? <button className="quest-entry" type="button">A Father's Shadow</button> : null}{!doorRepaired && <button className="quest-entry" type="button">The King's Generosity</button>}<div className="quest-list-heading">Completed <small>{(state?.prologue.quest_status === "completed" ? 1 : 0) + (doorRepaired ? 1 : 0)}</small></div>{state?.prologue.quest_status === "completed" ? <button className="quest-entry completed" type="button">A Father's Shadow</button> : null}{doorRepaired ? <button className="quest-entry completed" type="button">The King's Generosity</button> : <p className="ledger-empty">Complete the repair to close this ledger.</p>}</aside><section className="quest-details"><p className="context-label">Selected quest</p>{state?.prologue.quest_status === "active" ? <><h3>A Father's Shadow</h3><p className="muted">A stranger claims the King's account of your father's service is incomplete. Travel to Briarbrook and find someone who remembers him.</p><p className="quest-objective">{state.prologue.adventure_started ? "▣ Travel to Briarbrook — adventure underway" : "□ Accept the guided adventure to Briarbrook"}</p></> : state?.prologue.quest_status === "completed" ? <><h3>A Father's Shadow</h3><p className="muted">Master Garrick Cobb confirmed that your father was investigating something unrelated to the war shortly before his final campaign.</p><p className="quest-objective complete">▣ Investigation complete — a new lead has been recorded</p></> : <><h3>The King's Generosity</h3><p className="muted">Make the inherited shack safe enough that wildlife stops treating it as a promising rental.</p><p className="quest-objective">{woodOwned >= 10 ? "▣ Obtain 10 Common Wood" : `□ Obtain 10 Common Wood — ${woodOwned}/10`}</p><p className="quest-objective">{nailsOwned >= 6 ? "▣ Obtain or forge 6 Iron Nails" : `□ Obtain or forge 6 Iron Nails — ${nailsOwned}/6`}</p><p className="quest-objective">{doorRepaired ? "▣ Repair the homestead front door" : "□ Repair the homestead front door"}</p></>}</section></div></section>}
          {activeTab === "character" && <section className="panel-empty"><p className="context-label">Character</p><h2>A craftsperson on the road</h2><p className="muted">Attributes, mastery, equipment, and progression are not modeled in this vertical slice yet.</p></section>}
          {activeTab === "inventory" && <section className="panel-empty"><p className="context-label">Inventory</p><h2>Carried supplies</h2><p className="muted">Common Wood: {state?.resources.wood ?? 0} · Iron Ore: {state?.resources.iron_ore ?? 0} · Iron Nails: {state?.resources.iron_nails ?? 0}</p><p className="muted">Homestead storage: {storage.wood ?? 0} Wood · {storage.iron_ore ?? 0} Iron Ore · {storage.iron_nails ?? 0} Iron Nails</p></section>}
          {activeTab === "homestead" && state && <HomesteadView homestead={state.homestead} carried={state.resources} busy={busy} atHomestead={state.route_offset === 0} onAction={(action, payload) => void runPrologueAction(action, payload)} />}
        </section>

        {encounterOpen && combat && <section className="encounter-overlay" role="dialog" aria-modal="false" aria-labelledby="encounter-title">
          <div className="encounter-header"><div><p className="context-label">Temporary encounter</p><h2 id="encounter-title">Goblin in the timber</h2></div><span className={`combat-status ${combat.status}`}>{combat.status}</span></div>
          <p className="muted">A goblin highwayman blocks the old road. The terminal waits for your move.</p>
          <div className="combat-bars"><div><span>You</span><strong>{combat.player_hp} / {combat.player_max_hp}</strong><div className="health-track"><i style={{ width: `${(combat.player_hp / combat.player_max_hp) * 100}%` }} /></div></div><div><span>Goblin</span><strong>{combat.enemy_hp} / {combat.enemy_max_hp}</strong><div className="health-track enemy"><i style={{ width: `${(combat.enemy_hp / combat.enemy_max_hp) * 100}%` }} /></div></div></div>
          {combat.status === "active" ? <div className="combat-actions">{["attack", "defend"].map((action) => <button className="action-button" key={action} onClick={() => void combatAction(action as "attack" | "defend")} disabled={busy || combat.turn !== "player"}>{action === "attack" ? "⚔ Attack" : "◇ Defend"}</button>)}</div> : <button className="secondary-button" onClick={() => setEncounterOpen(false)}>Return to terminal</button>}
        </section>}

        <nav className="bottom-navigation" aria-label="Game navigation"><div className="nav-group nav-group-left">{navigation.slice(0, 2).map((item) => <button key={item.id} className={`nav-button ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</div><button className={`nav-button nav-console ${activeTab === "console" ? "active" : ""}`} onClick={() => setActiveTab("console")} aria-current={activeTab === "console" ? "page" : undefined}><span className="nav-icon">⌂</span><span>Console</span></button><div className="nav-group nav-group-right">{navigation.slice(3).map((item) => <button key={item.id} className={`nav-button ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</div></nav>
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
