"""Apply inspected, checksum-bound domain decisions; unlisted sources stay excluded."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from fencecoach.data_policy import MODERN_DOMAINS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/training"))
    parser.add_argument("--decisions", type=Path, default=Path("datasets/source-curation.json"))
    args = parser.parse_args()
    decisions = json.loads(args.decisions.read_text(encoding="utf-8"))["sources"]
    lookup = {(r["collection"], r["clip_id"]): r for r in decisions}
    accepted = excluded = 0
    for file in sorted(args.data.glob("*/*/source.json")):
        source = json.loads(file.read_text(encoding="utf-8"))
        decision = lookup.get((file.parent.parent.name, file.parent.name))
        if decision and decision["sha256"] != source["sha256"]:
            raise ValueError(f"Curation source changed: {file.parent.name}")
        domain = decision["domain"] if decision else "unreviewed"
        eligible = (
            domain in MODERN_DOMAINS and decision.get("eligible", False) if decision else False
        )
        source.update(
            training_domain=domain,
            training_eligible=eligible,
            curation_sha256=source["sha256"],
            curation_note=decision["note"]
            if decision
            else "Not inspected for modern fencing relevance; excluded from training.",
        )
        file.write_text(json.dumps(source, indent=2), encoding="utf-8")
        if eligible:
            accepted += 1
        else:
            excluded += 1
    print(json.dumps(dict(eligible_modern_clips=accepted, excluded_or_unreviewed=excluded)))


if __name__ == "__main__":
    main()
