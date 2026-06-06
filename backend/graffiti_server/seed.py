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

SEED_MEMORY_CLUSTERS = [
    (
        25.0330,
        121.5654,
        [
            "I came here after quitting and sat for an hour pretending I had a plan.",
            "I almost called my ex from this corner and chose myself instead.",
            "I told everyone I was excited, but I was mostly scared.",
            "This was the first place I felt alone in a city full of people.",
        ],
    ),
    (
        25.0368,
        121.5641,
        [
            "I read the message here and knew the friendship was over.",
            "I lied and said I was nearby because I did not want to go home yet.",
            "Someone held my hand here like it was the easiest thing in the world.",
            "I keep passing this place hoping to feel like that version of me again.",
        ],
    ),
    (
        25.0298,
        121.5688,
        [
            "I cried quietly behind my sunglasses and nobody noticed.",
            "I promised myself I would stop shrinking to make other people comfortable.",
            "This is where I realized missing someone is not the same as wanting them back.",
            "I sent a voice memo from here and deleted it before they could hear me.",
        ],
    ),
    (
        25.0412,
        121.5586,
        [
            "I waited here for someone who had already stopped choosing me.",
            "My dad called and I ignored it. I still think about that.",
            "I bought coffee I could not afford because I needed to feel normal.",
            "I practiced saying goodbye out loud before I actually did it.",
        ],
    ),
    (
        25.0267,
        121.5622,
        [
            "I was supposed to be celebrating, but I felt completely hollow.",
            "I took a picture here and posted it like I was happy.",
            "This corner knows a version of me nobody else met.",
            "I forgave someone here, but I never told them.",
        ],
    ),
    (
        25.0378,
        121.5732,
        [
            "I saw them laughing with someone new and surprised myself by surviving it.",
            "I sat here until the anger turned into sadness.",
            "This place smelled like rain and bad timing.",
            "I decided not to send the paragraph. That was growth, unfortunately.",
        ],
    ),
    (
        25.0311,
        121.5531,
        [
            "I admitted to myself here that I did not want the life I had built.",
            "I was late because I stood here rehearsing how to be honest.",
            "I used to think leaving meant failing. Now I am not so sure.",
            "A stranger smiled at me here on the worst day of my year.",
        ],
    ),
    (
        25.0455,
        121.5705,
        [
            "I watched the city lights and felt small in a way that helped.",
            "I told them I was fine because the truth felt too expensive.",
            "I kept a secret here for three years.",
            "This is where I stopped confusing chaos for chemistry.",
        ],
    ),
    (
        25.0222,
        121.5716,
        [
            "I came here after the interview and knew I had bombed it.",
            "I made a wish here and pretended I was joking.",
            "I walked past this spot every day while becoming someone else.",
            "I wish I had been kinder to the person I was then.",
        ],
    ),
    (
        25.0393,
        121.5488,
        [
            "I found out here that love can be real and still not be enough.",
            "I stood here with a secret and wanted someone to guess it.",
            "This is where I realized I was waiting for permission to leave.",
            "I miss who I was before I learned how to pretend.",
        ],
    ),
    (
        25.0289,
        121.5794,
        [
            "I almost moved away. Sometimes I think this street convinced me not to.",
            "I called my mom here and lied about eating dinner.",
            "The sunset was ridiculous and I had no one to send it to.",
            "I felt proud of myself here and did not know where to put it.",
        ],
    ),
    (
        25.0466,
        121.5608,
        [
            "I met someone here who made the future feel less abstract.",
            "I said yes too quickly and regretted it before I got home.",
            "This spot reminds me that tenderness can arrive without warning.",
            "I left something behind here that I hope I never need again.",
        ],
    ),
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
    seed_bodies = {body for _, _, bodies in SEED_MEMORY_CLUSTERS for body in bodies}
    with connect(path) as conn:
        ensure_anonymous_user(conn, SEED_USER_ID)
        conn.execute(
            """
            DELETE FROM memories
            WHERE created_by_anonymous_id = ?
              AND body NOT IN ({})
            """.format(",".join("?" for _ in seed_bodies)),
            (SEED_USER_ID, *sorted(seed_bodies)),
        )
        existing_bodies = {
            row["body"]
            for row in conn.execute(
                "SELECT body FROM memories WHERE created_by_anonymous_id = ?",
                (SEED_USER_ID,),
            ).fetchall()
        }

    now = datetime.now(timezone.utc)
    index = 0
    for lat, lng, bodies in SEED_MEMORY_CLUSTERS:
        geohash = encode_geohash(lat, lng)
        for body in bodies:
            if body in existing_bodies:
                index += 1
                continue
            create_memory(
                body=body,
                latitude=lat,
                longitude=lng,
                geohash=geohash,
                visibility="free",
                anonymous_user_id=SEED_USER_ID,
                path=path,
                created_at=(now - timedelta(days=40 + index * 11)).isoformat(timespec="seconds").replace("+00:00", "Z"),
            )
            created += 1
            index += 1
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
