"""SQLite storage for the Graffiti MVP."""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .cells import normalize_geohash

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "graffiti.sqlite3"


def db_path() -> Path:
    return Path(os.getenv("GRAFFITI_DB_PATH", str(DEFAULT_DB_PATH))).expanduser()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect(path: Path | None = None) -> sqlite3.Connection:
    target = path or db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: Path | None = None) -> None:
    with connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS anonymous_users (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS traces (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 140),
                geohash TEXT NOT NULL,
                created_by_anonymous_id TEXT NOT NULL REFERENCES anonymous_users(id),
                created_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE INDEX IF NOT EXISTS ix_traces_geohash_created_at
            ON traces (geohash, created_at)
            WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS trace_echoes (
                trace_id TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
                anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (trace_id, anonymous_user_id)
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
                link_url TEXT,
                sketch_json TEXT NOT NULL DEFAULT '[]',
                photo_base64 TEXT,
                photo_mime_type TEXT,
                author_name TEXT,
                visibility TEXT NOT NULL CHECK (visibility IN ('folded', 'free')),
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                geohash TEXT NOT NULL,
                created_by_anonymous_id TEXT NOT NULL REFERENCES anonymous_users(id),
                created_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE INDEX IF NOT EXISTS ix_memories_visibility_geohash_created_at
            ON memories (visibility, geohash, created_at)
            WHERE deleted_at IS NULL;

            CREATE INDEX IF NOT EXISTS ix_memories_creator_created_at
            ON memories (created_by_anonymous_id, created_at)
            WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS memory_echoes (
                memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (memory_id, anonymous_user_id)
            );
            """
        )
        ensure_column(conn, "memories", "photo_base64", "ALTER TABLE memories ADD COLUMN photo_base64 TEXT")
        ensure_column(conn, "memories", "photo_mime_type", "ALTER TABLE memories ADD COLUMN photo_mime_type TEXT")
        ensure_column(conn, "memories", "author_name", "ALTER TABLE memories ADD COLUMN author_name TEXT")


def ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    try:
        conn.execute(f"SELECT {column} FROM {table} LIMIT 0")
    except sqlite3.OperationalError as exc:
        if "no such column" in str(exc).lower():
            conn.execute(ddl)
            return
        raise


def parse_uuid(value: str | None, *, field_name: str = "id") -> str:
    if not value:
        raise ValueError(f"{field_name} is required")
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a UUID") from exc


def ensure_anonymous_user(conn: sqlite3.Connection, anonymous_user_id: str) -> None:
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    conn.execute(
        """
        INSERT INTO anonymous_users (id, created_at)
        VALUES (?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (user_id, utc_now_iso()),
    )


def normalize_trace_text(text: Any) -> str:
    if not isinstance(text, str):
        raise ValueError("text is required")
    normalized = " ".join(text.strip().split())
    if not normalized:
        raise ValueError("text is required")
    if len(normalized) > 140:
        raise ValueError("text must be 140 characters or fewer")
    return normalized


def normalize_memory_body(text: Any) -> str:
    if not isinstance(text, str):
        raise ValueError("body is required")
    normalized = " ".join(text.strip().split())
    if not normalized:
        raise ValueError("body is required")
    if len(normalized) > 500:
        raise ValueError("body must be 500 characters or fewer")
    return normalized


def normalize_visibility(value: Any) -> str:
    if value not in {"folded", "free"}:
        raise ValueError("visibility must be folded or free")
    return str(value)


def normalize_coordinate(value: Any, *, field_name: str, min_value: float, max_value: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} is required") from exc
    if not (min_value <= number <= max_value):
        raise ValueError(f"{field_name} is out of range")
    return number


def wall_summary(geohash: str, path: Path | None = None) -> dict[str, Any]:
    cell = normalize_geohash(geohash)
    with connect(path) as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS trace_count, MIN(created_at) AS oldest_trace_at
            FROM traces
            WHERE geohash = ? AND deleted_at IS NULL
            """,
            (cell,),
        ).fetchone()
    return {
        "geohash": cell,
        "trace_count": int(row["trace_count"]),
        "oldest_trace_at": row["oldest_trace_at"],
    }


def list_traces(geohash: str, anonymous_user_id: str | None = None, path: Path | None = None) -> list[dict[str, Any]]:
    cell = normalize_geohash(geohash)
    viewer_id = parse_uuid(anonymous_user_id, field_name="anonymous user id") if anonymous_user_id else None
    with connect(path) as conn:
        rows = conn.execute(
            """
            SELECT
                t.id,
                t.text,
                t.geohash,
                t.created_at,
                COUNT(e.anonymous_user_id) AS echo_count,
                MAX(CASE WHEN e.anonymous_user_id = ? THEN 1 ELSE 0 END) AS echoed_by_me
            FROM traces t
            LEFT JOIN trace_echoes e ON e.trace_id = t.id
            WHERE t.geohash = ? AND t.deleted_at IS NULL
            GROUP BY t.id
            ORDER BY t.created_at ASC
            """,
            (viewer_id, cell),
        ).fetchall()
    return [trace_row_to_dict(row) for row in rows]


def create_trace(
    *,
    geohash: str,
    text: Any,
    anonymous_user_id: str,
    path: Path | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    cell = normalize_geohash(geohash)
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    body = normalize_trace_text(text)
    trace_id = str(uuid.uuid4())
    timestamp = created_at or utc_now_iso()
    with connect(path) as conn:
        ensure_anonymous_user(conn, user_id)
        conn.execute(
            """
            INSERT INTO traces (id, text, geohash, created_by_anonymous_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (trace_id, body, cell, user_id, timestamp),
        )
        row = conn.execute(
            """
            SELECT id, text, geohash, created_at, 0 AS echo_count, 0 AS echoed_by_me
            FROM traces
            WHERE id = ?
            """,
            (trace_id,),
        ).fetchone()
    return trace_row_to_dict(row)


def set_echo(trace_id: str, anonymous_user_id: str, enabled: bool, path: Path | None = None) -> dict[str, Any]:
    parsed_trace_id = parse_uuid(trace_id, field_name="trace id")
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    with connect(path) as conn:
        ensure_anonymous_user(conn, user_id)
        exists = conn.execute(
            "SELECT 1 FROM traces WHERE id = ? AND deleted_at IS NULL",
            (parsed_trace_id,),
        ).fetchone()
        if not exists:
            raise LookupError("trace not found")
        if enabled:
            conn.execute(
                """
                INSERT INTO trace_echoes (trace_id, anonymous_user_id, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(trace_id, anonymous_user_id) DO NOTHING
                """,
                (parsed_trace_id, user_id, utc_now_iso()),
            )
        else:
            conn.execute(
                "DELETE FROM trace_echoes WHERE trace_id = ? AND anonymous_user_id = ?",
                (parsed_trace_id, user_id),
            )
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS echo_count,
                MAX(CASE WHEN anonymous_user_id = ? THEN 1 ELSE 0 END) AS echoed_by_me
            FROM trace_echoes
            WHERE trace_id = ?
            """,
            (user_id, parsed_trace_id),
        ).fetchone()
    return {
        "trace_id": parsed_trace_id,
        "echo_count": int(row["echo_count"]),
        "echoed_by_me": bool(row["echoed_by_me"]),
    }


def trace_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "text": row["text"],
        "geohash": row["geohash"],
        "created_at": row["created_at"],
        "echo_count": int(row["echo_count"]),
        "echoed_by_me": bool(row["echoed_by_me"]),
    }


def list_memories(
    anonymous_user_id: str,
    path: Path | None = None,
    *,
    limit: int = 250,
) -> list[dict[str, Any]]:
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    with connect(path) as conn:
        ensure_anonymous_user(conn, user_id)
        rows = conn.execute(
            """
            SELECT
                m.id,
                m.body,
                m.link_url,
                m.sketch_json,
                m.photo_base64,
                m.photo_mime_type,
                m.author_name,
                m.visibility,
                m.latitude,
                m.longitude,
                m.geohash,
                m.created_at,
                COUNT(e.anonymous_user_id) AS echo_count,
                MAX(CASE WHEN e.anonymous_user_id = ? THEN 1 ELSE 0 END) AS echoed_by_me,
                CASE WHEN m.created_by_anonymous_id = ? THEN 1 ELSE 0 END AS mine
            FROM memories m
            LEFT JOIN memory_echoes e ON e.memory_id = m.id
            WHERE m.deleted_at IS NULL
              AND (m.visibility = 'free' OR m.created_by_anonymous_id = ?)
            GROUP BY m.id
            ORDER BY m.created_at ASC
            LIMIT ?
            """,
            (user_id, user_id, user_id, max(1, min(limit, 500))),
        ).fetchall()
    return [memory_row_to_dict(row) for row in rows]


def create_memory(
    *,
    body: Any,
    latitude: Any,
    longitude: Any,
    geohash: str,
    visibility: Any,
    anonymous_user_id: str,
    link_url: Any = None,
    sketch_json: Any = "[]",
    photo_base64: Any = None,
    photo_mime_type: Any = None,
    author_name: Any = None,
    path: Path | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    memory_id = str(uuid.uuid4())
    normalized_body = normalize_memory_body(body)
    cell = normalize_geohash(geohash)
    lat = normalize_coordinate(latitude, field_name="latitude", min_value=-90, max_value=90)
    lng = normalize_coordinate(longitude, field_name="longitude", min_value=-180, max_value=180)
    normalized_visibility = normalize_visibility(visibility)
    normalized_link = str(link_url).strip() if isinstance(link_url, str) and link_url.strip() else None
    normalized_sketch = sketch_json if isinstance(sketch_json, str) and sketch_json.strip() else "[]"
    normalized_photo = str(photo_base64).strip() if isinstance(photo_base64, str) and photo_base64.strip() else None
    normalized_photo_mime_type = (
        str(photo_mime_type).strip()[:80]
        if isinstance(photo_mime_type, str) and photo_mime_type.strip()
        else None
    )
    normalized_author = str(author_name).strip()[:100] if isinstance(author_name, str) and author_name.strip() else None
    timestamp = created_at or utc_now_iso()

    with connect(path) as conn:
        ensure_anonymous_user(conn, user_id)
        conn.execute(
            """
            INSERT INTO memories (
                id, body, link_url, sketch_json, photo_base64, photo_mime_type, author_name,
                visibility, latitude, longitude, geohash, created_by_anonymous_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                memory_id,
                normalized_body,
                normalized_link,
                normalized_sketch,
                normalized_photo,
                normalized_photo_mime_type,
                normalized_author,
                normalized_visibility,
                lat,
                lng,
                cell,
                user_id,
                timestamp,
            ),
        )
        row = conn.execute(
            """
            SELECT
                id,
                body,
                link_url,
                sketch_json,
                photo_base64,
                photo_mime_type,
                author_name,
                visibility,
                latitude,
                longitude,
                geohash,
                created_at,
                0 AS echo_count,
                0 AS echoed_by_me,
                1 AS mine
            FROM memories
            WHERE id = ?
            """,
            (memory_id,),
        ).fetchone()
    return memory_row_to_dict(row)


def set_memory_echo(memory_id: str, anonymous_user_id: str, enabled: bool, path: Path | None = None) -> dict[str, Any]:
    parsed_memory_id = parse_uuid(memory_id, field_name="memory id")
    user_id = parse_uuid(anonymous_user_id, field_name="anonymous user id")
    with connect(path) as conn:
        ensure_anonymous_user(conn, user_id)
        exists = conn.execute(
            """
            SELECT 1
            FROM memories
            WHERE id = ? AND deleted_at IS NULL AND visibility = 'free'
            """,
            (parsed_memory_id,),
        ).fetchone()
        if not exists:
            raise LookupError("memory not found")
        if enabled:
            conn.execute(
                """
                INSERT INTO memory_echoes (memory_id, anonymous_user_id, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(memory_id, anonymous_user_id) DO NOTHING
                """,
                (parsed_memory_id, user_id, utc_now_iso()),
            )
        else:
            conn.execute(
                "DELETE FROM memory_echoes WHERE memory_id = ? AND anonymous_user_id = ?",
                (parsed_memory_id, user_id),
            )
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS echo_count,
                MAX(CASE WHEN anonymous_user_id = ? THEN 1 ELSE 0 END) AS echoed_by_me
            FROM memory_echoes
            WHERE memory_id = ?
            """,
            (user_id, parsed_memory_id),
        ).fetchone()
    return {
        "memory_id": parsed_memory_id,
        "echo_count": int(row["echo_count"]),
        "echoed_by_me": bool(row["echoed_by_me"]),
    }


def memory_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "body": row["body"],
        "link_url": row["link_url"],
        "sketch_json": row["sketch_json"],
        "photo_base64": row["photo_base64"],
        "photo_mime_type": row["photo_mime_type"],
        "author_name": row["author_name"],
        "visibility": row["visibility"],
        "latitude": float(row["latitude"]),
        "longitude": float(row["longitude"]),
        "geohash": row["geohash"],
        "created_at": row["created_at"],
        "echo_count": int(row["echo_count"]),
        "echoed_by_me": bool(row["echoed_by_me"]),
        "mine": bool(row["mine"]),
    }
