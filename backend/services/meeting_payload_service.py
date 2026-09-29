"""Compact read models for the meeting workspace first paint."""


def compact_meeting_detail(payload: dict) -> dict:
    compact = dict(payload)
    # Records and transcript events have dedicated APIs. Returning them here
    # duplicates megabytes of JSON for completed meetings.
    compact.pop("generatedRecords", None)
    compact.pop("events", None)
    return compact


def compact_generated_record(records: dict | None) -> dict | None:
    if not isinstance(records, dict):
        return records
    compact = dict(records)
    map_results = compact.pop("mapResults", [])
    compact["hasMappedTopics"] = any(
        (item.get("output") or {}).get("topics")
        for item in map_results
        if isinstance(item, dict)
    )
    compact.pop("documents", None)
    compact.pop("_recordParagraphs", None)
    compact.pop("recordBlocks", None)
    coverage = compact.get("coverage")
    if isinstance(coverage, dict):
        compact["coverage"] = {
            "sourceSegmentCount": coverage.get("sourceSegmentCount", 0),
            "sourceFileCount": coverage.get("sourceFileCount", 0),
        }
    return compact


def compact_records_snapshot(snapshot: dict) -> dict:
    return {
        **snapshot,
        "records": compact_generated_record(snapshot.get("records")),
        "pendingRecords": compact_generated_record(snapshot.get("pendingRecords")),
    }
