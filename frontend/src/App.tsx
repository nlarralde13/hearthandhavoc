import { useCallback, useEffect, useMemo, useState } from "react";

type SaveState = {
  save_id: string;
  background_id: string;
  state_version: number;
  content_version: string;
  route_id: string;
  route_offset: number;
  discovered_locations: string[];
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

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">A small world, stubbornly alive</p>
          <h1>Hearth <span>&amp;</span> Havoc</h1>
        </div>
        <div className="version">content {state?.content_version ?? "—"}</div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="hero-panel">
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
      </section>

      <section className="dashboard-grid">
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
      </section>
    </main>
  );
}
