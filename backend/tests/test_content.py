import pytest
from app.content import ContentError, validate_all_content, validate_route_record


def test_all_checked_in_content_is_valid() -> None:
    assert validate_all_content() == ["western_road"]


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
