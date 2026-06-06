"""Seed demo traces for a location cell."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .cells import encode_geohash, normalize_geohash
from .db import connect, create_memory, create_trace, ensure_anonymous_user, init_db

SEED_USER_ID = "00000000-0000-4000-8000-000000000001"

SEED_TRACES = [
    ("First day here. I pretended I knew where I was going.", 5 * 365),
    ("I called my mom from this spot and told her I was fine.", 4 * 365 + 40),
    ("We waited out the rain here and never really left each other after that.", 3 * 365 + 12),
    ("This used to feel bigger.", 2 * 365 + 21),
    ("If you're reading this, I hope it worked out.", 365 + 120),
    ("Good luck. I mean it.", 270),
    ("Skipped the thing I was supposed to do. No regrets yet.", 75),
    ("Someone stood here before you. Now you know.", 12),
]

SEED_MEMORIES = [
    ("First day of college. I was terrified.", 25.0330, 121.5654, "free"),
    ("Beautiful sunset, just left my job.", 25.0336, 121.5661, "free"),
    ("I kept this one folded. It still counts.", 25.0324, 121.5646, "folded"),
]


def seed_cell(geohash: str, path: Path | None = None) -> int:
    cell = normalize_geohash(geohash)
    init_db(path)
    created = 0
    with connect(path) as conn:
        ensure_anonymous_user(conn, SEED_USER_ID)
        existing_texts = {
            row["text"]
            for row in conn.execute(
                "SELECT text FROM traces WHERE geohash = ? AND created_by_anonymous_id = ?",
                (cell, SEED_USER_ID),
            ).fetchall()
        }

    now = datetime.now(timezone.utc)
    for text, days_ago in SEED_TRACES:
        if text in existing_texts:
            continue
        timestamp = (now - timedelta(days=days_ago)).isoformat(timespec="seconds").replace("+00:00", "Z")
        create_trace(
            geohash=cell,
            text=text,
            anonymous_user_id=SEED_USER_ID,
            path=path,
            created_at=timestamp,
        )
        created += 1
    return created


def seed_memories(path: Path | None = None) -> int:
    init_db(path)
    created = 0
    with connect(path) as conn:
        ensure_anonymous_user(conn, SEED_USER_ID)
        existing_bodies = {
            row["body"]
            for row in conn.execute(
                "SELECT body FROM memories WHERE created_by_anonymous_id = ?",
                (SEED_USER_ID,),
            ).fetchall()
        }

    now = datetime.now(timezone.utc)
    for index, (body, lat, lng, visibility) in enumerate(SEED_MEMORIES):
        if body in existing_bodies:
            continue
        create_memory(
            body=body,
            latitude=lat,
            longitude=lng,
            geohash=encode_geohash(lat, lng),
            visibility=visibility,
            anonymous_user_id=SEED_USER_ID,
            path=path,
            created_at=(now - timedelta(days=365 + index * 40)).isoformat(timespec="seconds").replace("+00:00", "Z"),
        )
        created += 1
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo traces for a Graffiti wall.")
    parser.add_argument("--geohash", help="Existing geohash cell to seed.")
    parser.add_argument("--lat", type=float, help="Latitude to encode if geohash is omitted.")
    parser.add_argument("--lng", type=float, help="Longitude to encode if geohash is omitted.")
    parser.add_argument("--precision", type=int, default=7)
    args = parser.parse_args()

    if args.geohash:
        geohash = normalize_geohash(args.geohash)
    elif args.lat is not None and args.lng is not None:
        geohash = encode_geohash(args.lat, args.lng, args.precision)
    else:
        geohash = encode_geohash(25.0330, 121.5654, args.precision)

    trace_count = seed_cell(geohash)
    memory_count = seed_memories()
    print(f"seeded {trace_count} trace(s) into wall {geohash}")
    print(f"seeded {memory_count} plane memory/memories")


if __name__ == "__main__":
    main()
