"""A scratch pad for trying out arvo-core (py) as it currently exists on
disk -- not the last published PyPI release.

`arvo-core` is linked here as an editable install pointing at
`../arvo-core`, so this always sees whatever is currently in
`py/arvo-core/src/` -- no build or publish step needed; edit and re-run.

Run with `uv run sandbox`.
"""

from arvo_core.event import ArvoEvent


def main() -> None:
    event = ArvoEvent(
        subject="order-42",
        source="order-service",
        type="order.created",
        data={"amount": 100},
        dataschema="#/contracts/order",
    )
    print("constructed:", event.id, event.subject, event.time)
    print("wire:", event.model_dump_json())
