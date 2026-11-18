import hashlib
from dataclasses import dataclass
from typing import Literal

Turn = Literal["player", "enemy"]
CombatStatus = Literal["active", "victory", "defeat"]
PlayerAction = Literal["attack", "defend"]


@dataclass(frozen=True)
class CombatState:
    seed: str
    turn: Turn
    status: CombatStatus
    round: int
    action_index: int
    player_hp: int
    player_max_hp: int
    player_ac: int
    player_attack_bonus: int
    player_damage_sides: int
    enemy_id: str
    enemy_hp: int
    enemy_max_hp: int
    enemy_ac: int
    enemy_attack_bonus: int
    enemy_damage_sides: int
    guarded: bool = False


@dataclass(frozen=True)
class CombatResult:
    state: CombatState
    events: tuple[dict, ...]


class CombatError(ValueError):
    pass


def deterministic_roll(seed: str, action_index: int, stream: str, sides: int = 20) -> int:
    if sides < 1:
        raise ValueError("roll must have at least one side")
    material = f"{seed}:{action_index}:{stream}".encode()
    digest = hashlib.sha256(material).digest()
    return int.from_bytes(digest[:8], "big") % sides + 1


def start_encounter(
    seed: str,
    *,
    enemy_id: str = "goblin",
    player_agility_modifier: int = 0,
    player_hp: int = 20,
    player_ac: int = 12,
    player_attack_bonus: int = 2,
    player_damage_sides: int = 6,
    enemy_hp: int = 8,
    enemy_ac: int = 10,
    enemy_attack_bonus: int = 2,
    enemy_damage_sides: int = 4,
) -> CombatState:
    player_initiative = deterministic_roll(seed, 0, "initiative.player") + player_agility_modifier
    enemy_initiative = deterministic_roll(seed, 0, "initiative.enemy") + 1
    return CombatState(
        seed=seed,
        turn="player" if player_initiative >= enemy_initiative else "enemy",
        status="active",
        round=1,
        action_index=0,
        player_hp=player_hp,
        player_max_hp=player_hp,
        player_ac=player_ac,
        player_attack_bonus=player_attack_bonus,
        player_damage_sides=player_damage_sides,
        enemy_id=enemy_id,
        enemy_hp=enemy_hp,
        enemy_max_hp=enemy_hp,
        enemy_ac=enemy_ac,
        enemy_attack_bonus=enemy_attack_bonus,
        enemy_damage_sides=enemy_damage_sides,
    )


def resolve_enemy_turn(state: CombatState) -> CombatResult:
    _require_active_turn(state, "enemy")
    natural = deterministic_roll(state.seed, state.action_index, "attack.enemy")
    total = natural + state.enemy_attack_bonus
    hit = natural != 1 and (natural == 20 or total >= state.player_ac)
    damage = 0
    player_hp = state.player_hp
    events: list[dict] = [
        {"type": "combat.enemy.attack", "roll": natural, "total": total, "hit": hit}
    ]
    if hit:
        damage = deterministic_roll(
            state.seed, state.action_index, "damage.enemy", state.enemy_damage_sides
        )
        if state.guarded:
            damage = max(1, damage // 2)
            events.append({"type": "combat.defend.reduced_damage"})
        player_hp = max(0, player_hp - damage)
        events.append({"type": "combat.damage", "target": "player", "amount": damage})

    if player_hp == 0:
        next_state = _with(state, player_hp=0, status="defeat", guarded=False)
    else:
        next_state = _with(state, turn="player", round=state.round + 1, guarded=False)
    return CombatResult(next_state, tuple(events))


def resolve_player_action(state: CombatState, action: PlayerAction) -> CombatResult:
    _require_active_turn(state, "player")
    if action not in ("attack", "defend"):
        raise CombatError(f"unsupported player action: {action}")

    if action == "defend":
        player_result = CombatResult(
            _with(state, guarded=True),
            ({"type": "combat.player.defend"},),
        )
    else:
        natural = deterministic_roll(state.seed, state.action_index, "attack.player")
        total = natural + state.player_attack_bonus
        hit = natural != 1 and (natural == 20 or total >= state.enemy_ac)
        events: list[dict] = [
            {"type": "combat.player.attack", "roll": natural, "total": total, "hit": hit}
        ]
        enemy_hp = state.enemy_hp
        if hit:
            damage = deterministic_roll(
                state.seed, state.action_index, "damage.player", state.player_damage_sides
            )
            if natural == 20:
                damage *= 2
                events.append({"type": "combat.critical"})
            enemy_hp = max(0, enemy_hp - damage)
            events.append({"type": "combat.damage", "target": "enemy", "amount": damage})
        player_result = CombatResult(_with(state, enemy_hp=enemy_hp), tuple(events))

    if player_result.state.enemy_hp == 0:
        return CombatResult(
            _with(
                player_result.state,
                status="victory",
                turn="player",
                action_index=state.action_index + 1,
            ),
            player_result.events + ({"type": "combat.victory", "enemy_id": state.enemy_id},),
        )

    enemy_result = resolve_enemy_turn(
        _with(player_result.state, turn="enemy", action_index=state.action_index)
    )
    return CombatResult(
        _with(enemy_result.state, action_index=state.action_index + 1),
        player_result.events + enemy_result.events,
    )


def _require_active_turn(state: CombatState, turn: Turn) -> None:
    if state.status != "active":
        raise CombatError("combat has already ended")
    if state.turn != turn:
        raise CombatError(f"it is not the {turn}'s turn")


def _with(state: CombatState, **changes: object) -> CombatState:
    values = state.__dict__ | changes
    return CombatState(**values)
