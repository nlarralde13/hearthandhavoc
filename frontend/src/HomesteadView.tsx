import { useState } from "react";

type HomesteadState = {
  rooms: Array<{ id: string; type: string; condition: string; upgrades: { front_door: string } }>;
  front_door: string;
  storage?: Record<string, number>;
};

type HomesteadAction = "homestead.deposit" | "craft.iron_nails" | "homestead.repair_door";

type Props = {
  homestead: HomesteadState;
  carried: Record<string, number>;
  busy: boolean;
  atHomestead: boolean;
  onAction: (action: HomesteadAction, payload?: Record<string, number>) => void;
};

function FloorPlan({ homestead, selected, onSelect }: { homestead: HomesteadState; selected: string; onSelect: (id: string) => void }) {
  const doorState = homestead.front_door === "repaired" ? "Repaired" : "Broken";
  return (
    <div className="management-floorplan" aria-label="Interactive homestead floor plan">
      <div className="floorplan-room" role="button" tabIndex={0} onClick={() => onSelect("main_room")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect("main_room"); }}>
        <span className="floorplan-room-label">MAIN ROOM</span>
        <button className={`floorplan-door ${homestead.front_door} ${selected === "front_door" ? "selected" : ""}`} type="button" aria-label={`Front door, ${doorState}`} onClick={(event) => { event.stopPropagation(); onSelect("front_door"); }} />
      </div>
    </div>
  );
}

export default function HomesteadView({ homestead, carried, busy, atHomestead, onAction }: Props) {
  const [selected, setSelected] = useState("front_door");
  const storage = homestead.storage ?? {};
  const doorRepaired = homestead.front_door === "repaired";
  const hasCarriedMaterials = Object.entries(carried).some(([key, value]) => ["wood", "iron_ore", "iron_nails"].includes(key) && value > 0);
  const readyToRepair = (storage.wood ?? 0) >= 10 && (storage.iron_nails ?? 0) >= 6;
  const status = doorRepaired ? "Completed" : readyToRepair ? "Ready to Build" : "Missing Materials";

  return (
    <section className="homestead-view" aria-label="Homestead management">
      <header className="homestead-header"><div><h2>Inherited Homestead</h2><p className="muted">A single-room shack, improving by degrees and refusing to collapse out of principle.</p></div><div className="homestead-condition"><span>Condition</span><strong>{doorRepaired ? "Improving" : "Dilapidated"}</strong></div></header>
      {!atHomestead && <div className="homestead-away" role="status">You must return to your homestead to perform this action.</div>}
      <div className="homestead-workspace">
        <div className="floorplan-stage"><FloorPlan homestead={homestead} selected={selected} onSelect={setSelected} /><p className="floorplan-caption">Select a room or structure to inspect it.</p></div>
        <aside className="homestead-inspector"><h3>{selected === "front_door" ? "Front Door" : "Main Room"}</h3>{selected === "front_door" ? <><p className="muted">The first line of defense against weather, wildlife, and visitors with poor timing.</p><div className={`structure-status ${doorRepaired ? "complete" : "pending"}`}>{doorRepaired ? "Repaired" : "Broken"}</div></> : <><p className="muted">A single-room shack with a serviceable floor and ambitious roof leaks.</p><div className="structure-status pending">Dilapidated</div></>}</aside>
      </div>
      <div className="homestead-management-grid">
        <section className="homestead-section"><div className="management-heading"><h3>To-Do / Upgrades</h3><span>{status}</span></div><h4>Repair Front Door</h4><div className="requirement-row"><span>Common Wood</span><strong className={(storage.wood ?? 0) >= 10 ? "met" : ""}>{storage.wood ?? 0} / 10</strong></div><div className="requirement-row"><span>Iron Nails</span><strong className={(storage.iron_nails ?? 0) >= 6 ? "met" : ""}>{storage.iron_nails ?? 0} / 6</strong></div><button className="primary-button management-action" type="button" disabled={!atHomestead || busy || doorRepaired || !readyToRepair} onClick={() => onAction("homestead.repair_door")}>{doorRepaired ? "Door Repaired" : "Repair Door"}</button></section>
        <section className="homestead-section"><div className="management-heading"><h3>Storage</h3><span>Homestead</span></div><div className="storage-list"><div><span>Common Wood</span><strong>{storage.wood ?? 0}</strong></div><div><span>Iron Ore</span><strong>{storage.iron_ore ?? 0}</strong></div><div><span>Iron Nails</span><strong>{storage.iron_nails ?? 0}</strong></div></div><button className="secondary-button management-action" type="button" disabled={!atHomestead || busy || !hasCarriedMaterials} onClick={() => onAction("homestead.deposit")}>Deposit Materials</button><p className="management-note">Carried: {carried.wood ?? 0} Wood · {carried.iron_ore ?? 0} Ore · {carried.iron_nails ?? 0} Nails</p></section>
        <section className="homestead-section future-section"><div className="management-heading"><h3>Future Facilities</h3><span>Coming later</span></div><p className="muted">Workshop, forge improvements, and expanded rooms will be added as the property earns them.</p></section>
      </div>
    </section>
  );
}
