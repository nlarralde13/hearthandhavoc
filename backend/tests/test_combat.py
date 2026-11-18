from dataclasses import replace

import pytest
from app.domain.combat import (
    CombatError,
    deterministic_roll,
    resolve_enemy_turn,
    resolve_player_action,
    start_encounter,
)


def player_turn_seed() -> str:
    for number in range(1000):
        seed = f"combat-{number}"
        state = start_encounter(seed)
        if state.turn == "player":
            return seed
    raise AssertionError("could not find a player-first deterministic seed")


def test_same_seed_produces_same_initiative_and_action_result() -> None:
    seed = player_turn_seed()

    first = resolve_player_action(start_encounter(seed), "attack")
    second = resolve_player_action(start_encounter(seed), "attack")

    assert first == second


def test_player_attack_automatically_resolves_enemy_turn() -> None:
    result = resolve_player_action(start_encounter(player_turn_seed()), "attack")

    assert any(event["type"] == "combat.enemy.attack" for event in result.events)
    assert result.state.action_index == 1
    assert result.state.turn == "player" or result.state.status == "defeat"


def test_defend_reduces_a_successful_enemy_hit() -> None:
    seed = next(
        f"defend-{number}"
        for number in range(10000)
        if start_encounter(f"defend-{number}").turn == "player"
        and deterministic_roll(f"defend-{number}", 0, "attack.enemy") + 2 >= 12
    )
    state = start_encounter(seed, player_hp=20)
    guarded = resolve_player_action(state, "defend")
    unguarded = resolve_enemy_turn(replace(state, turn="enemy"))

    assert guarded.state.player_hp >= unguarded.state.player_hp
    assert any(event["type"] == "combat.defend.reduced_damage" for event in guarded.events)


def test_natural_one_always_misses() -> None:
    seed = next(
        f"natural-one-{number}"
        for number in range(10000)
        if deterministic_roll(f"natural-one-{number}", 0, "attack.player") == 1
    )
    state = replace(start_encounter(seed), turn="player")

    result = resolve_player_action(state, "attack")

    attack = next(event for event in result.events if event["type"] == "combat.player.attack")
    assert attack["roll"] == 1
    assert attack["hit"] is False


def test_invalid_turn_and_finished_combat_are_rejected() -> None:
    with pytest.raises(CombatError, match="not the enemy's turn"):
        resolve_enemy_turn(start_encounter(player_turn_seed()))

    finished = replace(start_encounter(player_turn_seed()), status="victory")
    with pytest.raises(CombatError, match="already ended"):
        resolve_player_action(finished, "attack")
