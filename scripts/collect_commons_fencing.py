"""Download a bounded, explicitly licensed Wikimedia fencing inventory with provenance."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

DOURDAN = ("04", "10", "16", "20", "22", "23", "27", "31", "32", "33", "34", "35")
TITLES = [f"File:EVD-esgrima-{n:03}.ogv" for n in range(5)]
TITLES += [f"File:Coupe du Monde juniors Dourdan - {n}.webm" for n in DOURDAN]
TITLES += ["File:Epeefence.ogv", "File:Foilfence.ogv"]
TITLES += [f"File:EVD-florete-{n:03}.ogv" for n in range(5)]
TITLES += [
    "File:Aspromonte vs. Baldini.ogv",
    "File:T64 POZDNIAKOVA Sofia - AKSAMIT Monica, 29 May Moscow Sabre 2016.webm",
]
ALLOWED = {
    "CC0",
    "CC BY-SA 2.5",
    "CC BY-SA 2.5 co",
    "CC BY-SA 3.0",
    "CC BY-SA 4.0",
    "CC BY 3.0",
    "CC BY 4.0",
}


def fetch(url):
    return urlopen(
        Request(url, headers={"User-Agent": "FenceCoach/0.5 (local fencing dataset research)"}),
        timeout=60,
    )


def plain(value):
    return html.unescape(re.sub(r"<[^>]+>", "", str(value))).strip()


def collect(page, root):
    import av

    title = page["title"]
    info = page["imageinfo"][0]
    meta = {key: plain(value["value"]) for key, value in info["extmetadata"].items()}
    license_name = meta.get("LicenseShortName")
    if license_name not in ALLOWED:
        raise ValueError(
            f"License not in the documented collection policy: {title}: {license_name}"
        )
    name = title.removeprefix("File:")
    clip_id = (
        "dourdan-" + name.split(" - ")[-1].removesuffix(".webm")
        if "Dourdan" in name
        else Path(name).stem.lower()
    )
    folder = root / clip_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "source.video"
    expected = info["sha1"]
    url = info["url"].split("?")[0]
    if not target.exists() or hashlib.sha1(target.read_bytes()).hexdigest() != expected:
        temp = folder / "source.download"
        try:
            with fetch(url) as response, temp.open("wb") as output:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 100 * 1024 * 1024:
                        raise ValueError("Source exceeds the 100 MB collection bound.")
                    output.write(chunk)
            if hashlib.sha1(temp.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Wikimedia checksum differs: {title}")
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
    with target.open("rb") as data:
        digest = hashlib.file_digest(data, "sha256").hexdigest()
    with av.open(str(target)) as container:
        stream = container.streams.video[0]
        duration = round(container.duration / av.time_base * 1000)
        dimensions = dict(
            width=stream.width,
            height=stream.height,
            fps=float(stream.average_rate),
            duration_ms=duration,
        )
    group = (
        "dourdan-2014-event"
        if "Dourdan" in name
        else "amarillo-2007-event"
        if name in {"Epeefence.ogv", "Foilfence.ogv"}
        else "evd-coldeportes-instructional-cohort"
        if name.startswith("EVD-")
        else "commons-other-event-unverified"
    )
    record = dict(
        clip_id=clip_id,
        filename=name,
        source_url=url,
        source_page="https://commons.wikimedia.org/wiki/" + quote(title.replace(" ", "_")),
        license=license_name,
        license_url=meta["LicenseUrl"].replace("http:", "https:"),
        attribution=meta.get("Artist", ""),
        description=meta.get("ImageDescription", ""),
        archive_sha1=expected,
        sha256=digest,
        bytes=target.stat().st_size,
        teaching_topic="competition"
        if group != "evd-coldeportes-instructional-cohort"
        else "instructional_unreviewed",
        split_group=group,
        athlete_id="unknown",
        commercial_use=True,
        annotation_status="unlabeled",
        collected_at=datetime.now(UTC).isoformat(),
        **dimensions,
    )
    (folder / "commons-metadata.json").write_text(json.dumps(page, indent=2), encoding="utf-8")
    (folder / "source.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"Collected {clip_id}: {duration / 1000:.2f}s / {license_name}", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/training/commons"))
    parser.add_argument("--max-new", type=int, default=20)
    parser.add_argument(
        "--delay", type=float, default=15, help="Seconds between new media downloads (minimum 5)."
    )
    parser.add_argument(
        "--inventory-only",
        action="store_true",
        help="Save the catalog and retain existing downloads without requesting media.",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    query = urlencode(
        dict(
            action="query",
            titles="|".join(TITLES),
            prop="imageinfo",
            iiprop="url|sha1|size|extmetadata",
            format="json",
        )
    )
    with fetch("https://commons.wikimedia.org/w/api.php?" + query) as response:
        metadata = json.load(response)
    pages = sorted(metadata["query"]["pages"].values(), key=lambda p: TITLES.index(p["title"]))
    if len(pages) != len(TITLES) or any("imageinfo" not in page for page in pages):
        raise SystemExit("Wikimedia inventory changed; inspect metadata before collection.")
    (args.output / "inventory-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    records, pending, paused, downloaded = [], [], False, 0
    for page in pages:
        existing = next(
            (
                p
                for p in args.output.glob("*/source.json")
                if json.loads(p.read_text(encoding="utf-8"))["filename"]
                == page["title"].removeprefix("File:")
            ),
            None,
        )
        if existing:
            records.append(json.loads(existing.read_text(encoding="utf-8")))
            continue
        if args.inventory_only or downloaded >= args.max_new:
            pending.append(
                dict(
                    title=page["title"], reason="Inventory only or per-run download limit reached."
                )
            )
            continue
        if paused:
            pending.append(
                dict(title=page["title"], reason="Collection paused after server rate limit.")
            )
            continue
        try:
            if downloaded:
                time.sleep(max(5, args.delay))
            records.append(collect(page, args.output))
            downloaded += 1
        except HTTPError as exc:
            pending.append(dict(title=page["title"], http_status=exc.code, reason=str(exc)))
            if exc.code == 429:
                paused = True
        except (ValueError, OSError) as exc:
            pending.append(dict(title=page["title"], reason=str(exc)))
    (args.output / "manifest.json").write_text(
        json.dumps(
            dict(schema="fencecoach-source-manifest-v1", clips=records, pending=pending), indent=2
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            dict(
                clips=len(records),
                seconds=round(sum(r["duration_ms"] for r in records) / 1000, 2),
                bytes=sum(r["bytes"] for r in records),
            )
        )
    )


if __name__ == "__main__":
    main()
