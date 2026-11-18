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

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const USER_KEY = "hearth-and-havoc-dev-user";
const SAVE_KEY = "hearth-and-havoc-save-id";

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
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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
        setEvents(["You take stock of the damaged shack."]);
        return;
      }
      const loaded = await request<SaveState>(`/api/v1/saves/${saveId}/state`);
      setState(loaded);
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
    return Math.round((state.route_offset / 20) * 100);
  }, [state]);

  async function advanceTravel() {
    if (!state || busy || state.route_offset >= 20) return;
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
      setEvents((current) => [
        ...response.events.map((event) =>
          event.type === "location.discovered"
            ? `Discovered: ${event.location_id}`
            : `Travel advanced to turn ${event.offset}`,
        ),
        ...current,
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to advance travel.");
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
          <p className="eyebrow">Homestead · Western Road</p>
          <h2>The road west waits.</h2>
          <p className="muted">
            Your shack needs work. The forest has timber. Between the two lies a road,
            twenty turns, and almost certainly something with opinions about your equipment.
          </p>
        </div>
        <div className="turn-card">
          <span>Adventure turn</span>
          <strong>{state?.route_offset ?? "—"}<small> / 20</small></strong>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="card route-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Known route</p>
              <h3>Western Road</h3>
            </div>
            <span className="route-percent">{routeProgress}%</span>
          </div>
          <div className="progress-track" aria-label={`${routeProgress}% complete`}>
            <div className="progress-fill" style={{ width: `${routeProgress}%` }} />
          </div>
          <div className="route-map">
            <div className="route-line" />
            <div className="route-stop start"><span>⌂</span><small>Shack</small></div>
            <div className={`route-stop timber ${state?.discovered_locations.includes("old_timberwood") ? "known" : ""}`}>
              <span>♣</span><small>Timberwood</small>
            </div>
            <div className={`route-stop end ${state?.discovered_locations.includes("briarbrook") ? "known" : ""}`}>
              <span>◆</span><small>Briarbrook</small>
            </div>
          </div>
          <button className="primary-button" onClick={() => void advanceTravel()} disabled={!state || busy || state.route_offset >= 20}>
            {busy ? "Consulting the map…" : state?.route_offset === 20 ? "Road complete" : "Continue west"}
          </button>
        </article>

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
