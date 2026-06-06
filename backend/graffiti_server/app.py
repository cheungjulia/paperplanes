"""Dependency-light HTTP server for the Graffiti MVP."""

from __future__ import annotations

import argparse
import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from . import db
from .cells import normalize_geohash

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_ROOT = PROJECT_ROOT / "frontend" / "static"


class GraffitiHandler(BaseHTTPRequestHandler):
    server_version = "GraffitiMVP/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                self.send_json({"status": "healthy", "service": "graffiti"})
                return

            if path.startswith("/api/walls/"):
                geohash = normalize_geohash(path.removeprefix("/api/walls/"))
                self.send_json(db.wall_summary(geohash))
                return

            if path == "/api/traces":
                geohash = first_query_value(query, "geohash")
                if geohash is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "geohash is required")
                    return
                user_id = self.headers.get("X-Anonymous-User-Id")
                self.send_json({"traces": db.list_traces(geohash, user_id)})
                return

            if path == "/api/memories":
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                self.send_json({"memories": db.list_memories(user_id)})
                return

            if path.startswith("/api/"):
                self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
                return

            self.serve_static(path)
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception:
            self.log_error("Unhandled GET error")
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/traces":
                body = self.read_json_body()
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                trace = db.create_trace(
                    geohash=body.get("geohash"),
                    text=body.get("text"),
                    anonymous_user_id=user_id,
                )
                self.send_json({"trace": trace}, status=HTTPStatus.CREATED)
                return

            if path == "/api/memories":
                body = self.read_json_body()
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                memory = db.create_memory(
                    body=body.get("body"),
                    latitude=body.get("latitude"),
                    longitude=body.get("longitude"),
                    geohash=body.get("geohash"),
                    visibility=body.get("visibility"),
                    link_url=body.get("link_url"),
                    sketch_json=body.get("sketch_json"),
                    photo_base64=body.get("photo_base64"),
                    author_name=body.get("author_name"),
                    anonymous_user_id=user_id,
                )
                self.send_json({"memory": memory}, status=HTTPStatus.CREATED)
                return

            if path.startswith("/api/traces/") and path.endswith("/echo"):
                trace_id = path.removeprefix("/api/traces/").removesuffix("/echo").strip("/")
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                self.send_json(db.set_echo(trace_id, user_id, True))
                return

            if path.startswith("/api/memories/") and path.endswith("/echo"):
                memory_id = path.removeprefix("/api/memories/").removesuffix("/echo").strip("/")
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                self.send_json(db.set_memory_echo(memory_id, user_id, True))
                return

            self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
        except LookupError as exc:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(exc))
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "invalid JSON body")
        except Exception:
            self.log_error("Unhandled POST error")
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path.startswith("/api/traces/") and path.endswith("/echo"):
                trace_id = path.removeprefix("/api/traces/").removesuffix("/echo").strip("/")
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                self.send_json(db.set_echo(trace_id, user_id, False))
                return
            if path.startswith("/api/memories/") and path.endswith("/echo"):
                memory_id = path.removeprefix("/api/memories/").removesuffix("/echo").strip("/")
                user_id = self.headers.get("X-Anonymous-User-Id")
                if user_id is None:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "X-Anonymous-User-Id is required")
                    return
                self.send_json(db.set_memory_echo(memory_id, user_id, False))
                return
            self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
        except LookupError as exc:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(exc))
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception:
            self.log_error("Unhandled DELETE error")
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    def serve_static(self, path: str) -> None:
        requested = "/index.html" if path == "/" else path
        target = (STATIC_ROOT / requested.lstrip("/")).resolve()
        try:
            target.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
            return
        if not target.exists() or not target.is_file():
            target = STATIC_ROOT / "index.html"

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("JSON body must be an object")
        return parsed

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_common_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_error_json(self, status: HTTPStatus, detail: str) -> None:
        self.send_json({"detail": detail}, status=status)

    def send_common_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Anonymous-User-Id")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "public, max-age=60")


def first_query_value(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if not values:
        return None
    return values[0]


def run(host: str, port: int) -> None:
    db.init_db()
    server = ThreadingHTTPServer((host, port), GraffitiHandler)
    print(f"Graffiti running at http://{host}:{port}")
    print(f"SQLite database: {db.db_path()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Graffiti MVP server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8008)
    args = parser.parse_args()
    run(args.host, args.port)


if __name__ == "__main__":
    main()
