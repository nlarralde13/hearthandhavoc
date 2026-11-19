import pytest
from app.content import ContentError, load_npc_record, load_quest_record, validate_all_content, validate_route_record


def test_all_checked_in_content_is_valid() -> None:
    assert validate_all_content() == ["western_road"]


def test_master_garrick_content_contains_authored_father_lead() -> None:
    npc = load_npc_record("master_garrick_cobb")
    assert npc["display_name"] == "Master Garrick Cobb"
    assert "Briarbrook" in npc["dialogue"]["father_lead"]


def test_homestead_quest_content_contains_repair_objectives() -> None:
    quest = load_quest_record("the_kings_generosity")
    assert quest["title"] == "The King's Generosity"
    assert {objective["id"] for objective in quest["objectives"]} == {
        "common_wood", "iron_nails", "repair_front_door"
    }


def test_route_validation_rejects_duplicate_offsets() -> None:
    with pytest.raises(ContentError, match="waypoint data"):
        validate_route_record(
            {
                "content_version": "0.1.0",
                "route_id": "test_route",
                "display_name": "Test Route",
                "length": 4,
                "waypoints": [
                    {"location_id": "one", "offset": 2, "display_name": "One"},
                    {"location_id": "two", "offset": 2, "display_name": "Two"},
                ],
            },
            "test_route",
        )
