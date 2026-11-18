from dataclasses import dataclass


class GatheringError(ValueError):
    pass


@dataclass(frozen=True)
class GatheringResult:
    resources: dict[str, int]
    events: tuple[dict[str, object], ...]


def gather_wood(
    discovered: frozenset[str], resources: dict[str, int], location_id: str
) -> GatheringResult:
    if location_id != "old_timberwood":
        raise GatheringError("wood can only be gathered at Old Timberwood")
    if location_id not in discovered:
        raise GatheringError("Old Timberwood has not been discovered")

    updated = dict(resources)
    updated["wood"] = updated.get("wood", 0) + 3
    return GatheringResult(
        resources=updated,
        events=(
            {
                "type": "gathering.completed",
                "location_id": location_id,
                "resource": "wood",
                "amount": 3,
            },
        ),
    )
