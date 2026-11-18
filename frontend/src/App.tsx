import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type SaveState = {
  save_id: string;
  background_id: string;
  state_version: number;
  content_version: string;
  route_id: string;
  route_offset: number;
  discovered_locations: string[];
  resources: Record<string, number>;
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
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `travel-${Date.now()}`;
}

export default function App() {
  const [state, setState] = useState<SaveState | null>(null);
  const [routeMap, setRouteMap] = useState<RouteMap | null>(null);
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoTravel, setAutoTravel] = useState(true);
  const [countdown, setCountdown] = useState(AUTO_TRAVEL_DELAY_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [command, setCommand] = useState("");
  const [commandNotice, setCommandNotice] = useState<string | null>(null);

  const loadSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const saveId = localStorage.getItem(SAVE_KEY);
      if (!saveId) {
        const created = await request<SaveState>("/api/v1/saves", {
          method: "POST",
          body: JSON.stringify({ background_id: "blacksmith" }),
        });
        localStorage.setItem(SAVE_KEY, created.save_id);
        setState(created);
        setRouteMap(await request<RouteMap>(`/api/v1/saves/${created.save_id}/map`));
        setEvents(["You take stock of the damaged shack."]);
        return;
      }
      const loaded = await request<SaveState>(`/api/v1/saves/${saveId}/state`);
      setState(loaded);
      setRouteMap(await request<RouteMap>(`/api/v1/saves/${loaded.save_id}/map`));
      try {
        setCombat(await request<CombatState>(`/api/v1/saves/${loaded.save_id}/combat`));
      } catch {
        setCombat(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load save.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSave();
  }, [loadSave]);

  const routeProgress = useMemo(() => {
    if (!state) return 0;
    return Math.round((state.route_offset / (routeMap?.length ?? 20)) * 100);
  }, [routeMap, state]);

  const advanceTravel = useCallback(async () => {
    if (!state || busy || state.route_offset >= (routeMap?.length ?? 20)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action_id: actionId(),
          action: "travel.advance",
          expected_state_version: state.state_version,
          payload: {},
        }),
      });
      setState(response.state);
      setRouteMap(await request<RouteMap>(`/api/v1/saves/${response.state.save_id}/map`));
      const foundSomething = response.events.some((event) => event.type !== "travel.advanced");
      if (foundSomething || response.state.route_offset >= (routeMap?.length ?? 20)) {
        setAutoTravel(false);
      }
      setEvents((current) => [
        ...response.events.map((event) =>
          event.type === "location.discovered"
            ? `Discovered: ${event.location_id}`
            : `The road is quiet. Turn ${event.offset} passes.`,
        ),
        ...current,
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to advance travel.");
    } finally {
      setBusy(false);
    }
  }, [busy, routeMap?.length, state]);

  async function gatherWood() {
    if (!state || busy || !state.discovered_locations.includes("old_timberwood")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<ActionResponse>(`/api/v1/saves/${state.save_id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action_id: actionId(),
          action: "gather.wood",
          expected_state_version: state.state_version,
          payload: { location_id: "old_timberwood" },
        }),
      });
      setState(response.state);
      setEvents((current) => ["You gather 3 wood from Old Timberwood.", ...current]);
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
      const started = await request<CombatState>(`/api/v1/saves/${state.save_id}/combat`, {
        method: "POST",
        body: JSON.stringify({ enemy_id: "goblin" }),
      });
      setCombat(started);
      setEvents((current) => ["A goblin steps from the trees. It looks confident.", ...current]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start combat.");
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
    setEvents([]);
    localStorage.removeItem(SAVE_KEY);
    await loadSave();
    setAutoTravel(true);
  }

  async function combatAction(action: "attack" | "defend") {
    if (!state || !combat || busy || combat.status !== "active") return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<CombatActionResponse>(
        `/api/v1/saves/${state.save_id}/combat/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action_id: actionId(),
            action,
            expected_action_index: combat.action_index,
          }),
        },
      );
      setCombat(response.state);
      const messages = response.events.map((event) => {
        if (event.type === "combat.victory") return "The goblin is defeated.";
        if (event.type === "combat.defeat") return "You are defeated and wake at home.";
        if (event.type === "combat.critical") return "A critical strike. The goblin objects, briefly.";
        if (event.type === "combat.damage") return `${event.target === "player" ? "You take" : "The goblin takes"} ${event.amount} damage.`;
        if (event.type === "combat.player.defend") return "You brace behind your battered shield.";
        if (event.type === "combat.defend.reduced_damage") return "Your guard absorbs part of the blow.";
        if (event.type === "combat.enemy.attack") return "The goblin attacks.";
        return action === "attack" ? "You swing at the goblin." : "You steady yourself.";
      });
      setEvents((current) => [...messages, ...current]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to resolve combat action.");
    } finally {
      setBusy(false);
    }
  }

  const navigation: Array<{ id: TabId; label: string; icon: string }> = [
    { id: "journal", label: "Journal", icon: "▤" },
    { id: "map", label: "World Map", icon: "✧" },
    { id: "home", label: "Home", icon: "⌂" },
    { id: "character", label: "Character", icon: "♙" },
    { id: "inventory", label: "Inventory", icon: "▣" },
  ];

  const actions: ActionDefinition[] = combat?.status === "active"
    ? [
        { id: "attack", label: "Attack", icon: "⚔", enabled: !busy && combat.turn === "player", run: () => void combatAction("attack") },
        { id: "defend", label: "Defend", icon: "◇", enabled: !busy && combat.turn === "player", run: () => void combatAction("defend") },
        { id: "skills", label: "Skills", icon: "✦", enabled: false, hint: "Skills are not implemented yet." },
        { id: "items", label: "Items", icon: "▣", enabled: false, hint: "Combat items are not implemented yet." },
      ]
    : [
        { id: "travel", label: "Advance", icon: "➜", enabled: Boolean(state) && !busy && state?.route_offset !== routeMap?.length, run: () => void advanceTravel() },
        { id: "gather", label: "Gather", icon: "❖", enabled: Boolean(state?.discovered_locations.includes("old_timberwood")) && !busy, hint: "Gather wood at Old Timberwood.", run: () => void gatherWood() },
        { id: "explore", label: "Explore", icon: "⌖", enabled: false, hint: "Exploration actions are coming with the next location." },
        { id: "craft", label: "Craft", icon: "◆", enabled: false, hint: "Crafting is not implemented yet." },
      ];

  function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!command.trim()) return;
    setCommandNotice("Conversation is not connected yet. Your message was not sent.");
  }

  function renderEmptyPanel(title: string, eyebrow: string, body: string) {
    return (
      <section className="panel-empty">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
      </section>
    );
  }

  return (
    <main className="shell">
      <div className="game-console">
      <header className="masthead">
        <div>
          <p className="eyebrow">A small world, stubbornly alive</p>
          <h1>Hearth <span>&amp;</span> Havoc</h1>
        </div>
        <div className="masthead-actions">
          <div className="version">content {state?.content_version ?? "—"}</div>
          <button className="reset-button" onClick={() => void resetProgress()} disabled={busy}>
            Reset progress
          </button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="character-strip" aria-label="Character status">
        <div className="character-identity"><span className="crest">♜</span><div><strong>Blacksmith</strong><small>Development save · turn {state?.route_offset ?? "—"}</small></div></div>
        <div className="status-metric"><span>HP</span><strong>— / —</strong><small>not modeled</small></div>
        <div className="status-metric"><span>Stamina</span><strong>—</strong><small>not modeled</small></div>
        <div className="status-metric"><span>Wood</span><strong>{state?.resources.wood ?? 0}</strong><small>carried</small></div>
        <div className="status-metric"><span>State</span><strong>v{state?.state_version ?? "—"}</strong><small>saved</small></div>
      </section>

      {activeTab === "home" && <section className="hero-panel">
        <div>
          <p className="eyebrow">Homestead · {routeMap?.display_name ?? "Western Road"}</p>
          <h2>The road west waits.</h2>
          <p className="muted">
            Your shack needs work. The forest has timber. Between the two lies a road,
            twenty turns, and almost certainly something with opinions about your equipment.
          </p>
        </div>
        <div className="turn-card">
          <span>Adventure turn</span>
          <strong data-testid="adventure-turn">{state?.route_offset ?? "—"}<small> / {routeMap?.length ?? 20}</small></strong>
        </div>
      </section>}

      {activeTab === "home" && <section className="dashboard-grid">
        <article className="card route-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Known route</p>
              <h3>{routeMap?.display_name ?? "Western Road"}</h3>
            </div>
            <span className="route-percent">{routeProgress}%</span>
          </div>
          <div className="progress-track" aria-label={`${routeProgress}% complete`}>
            <div className="progress-fill" style={{ width: `${routeProgress}%` }} />
          </div>
          <div className="route-map">
            <div className="route-line" />
            <div className="route-stop start"><span>⌂</span><small>Shack</small></div>
            {routeMap?.waypoints.map((waypoint, index) => (
              <div className={`route-stop ${waypoint.known ? "known" : ""}`} key={waypoint.offset}>
                <span>{index === routeMap.waypoints.length - 1 ? "◆" : "♣"}</span>
                <small data-testid={`route-waypoint-${waypoint.offset}`}>{waypoint.label}</small>
              </div>
            ))}
          </div>
          <div className="travel-controls">
            <div className="travel-status" aria-live="polite">
              {state?.route_offset === routeMap?.length
                ? "The road is complete."
                : autoTravel
                  ? `Auto-travel resumes in ${countdown}s`
                  : "Auto-travel paused"}
            </div>
            <button className="primary-button" onClick={() => void advanceTravel()} disabled={!state || busy || state.route_offset >= (routeMap?.length ?? 20)}>
              {busy ? "Consulting the map…" : state?.route_offset === routeMap?.length ? "Road complete" : "Advance one turn"}
            </button>
            {state && state.route_offset < (routeMap?.length ?? 20) && (
              <button className="secondary-button travel-toggle" onClick={() => setAutoTravel((current) => !current)} disabled={busy}>
                {autoTravel ? "Pause auto-travel" : "Resume auto-travel"}
              </button>
            )}
          </div>
        </article>

        {state?.discovered_locations.includes("old_timberwood") && (
          <article className="card combat-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Encounter</p>
                <h3>Goblin in the timber</h3>
              </div>
              {combat && <span className={`combat-status ${combat.status}`}>{combat.status}</span>}
            </div>
            {!combat && (
              <>
                <p className="muted">Something small, green, and poorly mannered has noticed you.</p>
                <button className="primary-button" onClick={() => void beginCombat()} disabled={busy}>
                  Face the goblin
                </button>
              </>
            )}
            {combat && (
              <>
                <div className="combat-bars">
                  <div><span>You</span><strong>{combat.player_hp} / {combat.player_max_hp}</strong><div className="health-track"><i style={{ width: `${(combat.player_hp / combat.player_max_hp) * 100}%` }} /></div></div>
                  <div><span>Goblin</span><strong>{combat.enemy_hp} / {combat.enemy_max_hp}</strong><div className="health-track enemy"><i style={{ width: `${(combat.enemy_hp / combat.enemy_max_hp) * 100}%` }} /></div></div>
                </div>
                {combat.status === "active" ? (
                  <div className="combat-actions">
                    <button className="primary-button" onClick={() => void combatAction("attack")} disabled={busy || combat.turn !== "player"}>Attack</button>
                    <button className="secondary-button" onClick={() => void combatAction("defend")} disabled={busy || combat.turn !== "player"}>Defend</button>
                  </div>
                ) : <p className="muted">The encounter is resolved. The forest resumes pretending it saw nothing.</p>}
              </>
            )}
          </article>
        )}

        {state?.discovered_locations.includes("old_timberwood") && (
          <article className="card resource-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Gathering</p>
                <h3>Old Timberwood</h3>
              </div>
              <span className="resource-count">Wood · {state.resources.wood ?? 0}</span>
            </div>
            <p className="muted">The old trees are sturdy enough to become something useful.</p>
            <button className="primary-button" onClick={() => void gatherWood()} disabled={busy}>
              Gather wood
            </button>
          </article>
        )}

        <article className="card journal-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Journal</p>
              <h3>What has happened</h3>
            </div>
          </div>
          <ol className="journal-list">
            {events.length === 0 && <li className="muted">The page is quiet. Suspiciously quiet.</li>}
            {events.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)}
          </ol>
        </article>
      </section>}

      {activeTab === "journal" && renderEmptyPanel("The road's record", "Journal", "Discoveries and event history will collect here as the world grows.")}
      {activeTab === "map" && renderEmptyPanel("Western Road", "World Map", "The discovered route remains visible on Home. A broader world map will arrive with the next region.")}
      {activeTab === "character" && renderEmptyPanel("A craftsperson on the road", "Character", "Attributes, mastery, equipment, and progression are not modeled in this vertical slice yet.")}
      {activeTab === "inventory" && renderEmptyPanel("Carried supplies", "Inventory", `Wood: ${state?.resources.wood ?? 0}. Item slots and equipment will be added with crafting.`)}

      <form className="command-bar" onSubmit={submitCommand}>
        <button type="button" className="command-mode">▰ Talk <span>⌄</span></button>
        <input value={command} onChange={(event) => { setCommand(event.target.value); setCommandNotice(null); }} placeholder="Type a message or command…" aria-label="Message or command" />
        <button className="send-button" type="submit" disabled={!command.trim()}>Send</button>
      </form>
      {commandNotice && <p className="command-notice">{commandNotice}</p>}

      <section className="action-panel" aria-label="Contextual actions">
        <div className="section-heading"><div><p className="eyebrow">Available actions</p><h3>{combat?.status === "active" ? "Combat" : "Current context"}</h3></div><small>{combat?.status === "active" ? "Choose your move." : "The road waits."}</small></div>
        <div className="action-grid">
          {actions.map((action) => <button key={action.id} className={`action-button ${combat?.status === "active" ? "combat-action-button" : ""}`} disabled={!action.enabled} title={action.hint} onClick={action.run}>
            <span className="action-icon">{action.icon}</span><span>{action.label}</span>
          </button>)}
        </div>
      </section>

      <nav className="bottom-navigation" aria-label="Game navigation">
        {navigation.map((item) => <button key={item.id} className={`nav-button ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined}>
          <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
        </button>)}
      </nav>
      </div>
    </main>
  );
}
