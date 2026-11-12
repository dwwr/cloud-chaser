#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from soundcloud_pull import validate_source_url
from make_instrumental import parse_stems, prepare_separation


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
JOBS_ROOT = ROOT / "jobs"
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
AUDIO_SUFFIXES = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".mp4",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
AUDIO_TYPES = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
}
STATIC_FILES = {
    "index.html": "text/html; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
}
MODES = {"track", "instrumental"}
FORMATS = {
    "track": {"best", "mp3", "m4a", "opus"},
    "instrumental": {"wav", "mp3"},
}
DEFAULT_FORMAT = {"track": "best", "instrumental": "wav"}
LOG_LIMIT = 100_000


def command_for(
    mode: str,
    url: str,
    job_dir: Path,
    audio_format: str,
    stems: list[str] | None = None,
    submix: bool = False,
) -> list[str]:
    cli = str(ROOT / "cli.py")
    python = sys.executable
    downloads = str(job_dir / "downloads")
    if mode == "track":
        return [python, cli, "track", "-o", downloads, "--format", audio_format, "--", url]
    instrumental = str(job_dir / "instrumentals")
    command = [
        python,
        cli,
        "instrumental",
        "-o",
        downloads,
        "--instrumental-dir",
        instrumental,
    ]
    if audio_format == "mp3":
        command.append("--mp3")
    for stem in stems or []:
        command.extend(["--stems", stem])
    if submix:
        command.append("--submix")
    command.extend(["--", url])
    return command


def list_audio(directory: Path) -> list[Path]:
    found: list[Path] = []
    if not directory.is_dir():
        return found
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        if ".demucs-work" in path.parts:
            continue
        if path.suffix.lower() not in AUDIO_SUFFIXES:
            continue
        if path.name.endswith(".part"):
            continue
        found.append(path)
    found.sort()
    return found


def file_payload(job_id: str, job_dir: Path, path: Path) -> dict[str, str]:
    relative = path.relative_to(job_dir).as_posix()
    quoted = "/".join(quote(part) for part in relative.split("/"))
    return {"name": relative, "url": f"/files/{job_id}/{quoted}"}


def content_disposition(name: str) -> str:
    ascii_name = name.replace('"', "").encode("ascii", "ignore").decode() or "audio"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


def read_log(path: Path) -> str:
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > LOG_LIMIT:
        return text[-LOG_LIMIT:]
    return text


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.lock = threading.Lock()
        self.jobs: dict[str, dict[str, object]] = {}

    def create(
        self,
        url: str,
        mode: str,
        audio_format: str,
        stems: list[str] | None = None,
        submix: bool = False,
    ) -> dict[str, object]:
        if mode not in MODES:
            raise ValueError("Mode must be track or instrumental.")
        if audio_format not in FORMATS[mode]:
            raise ValueError("That file type is not available for this download.")
        chosen: list[str] | None = None
        if mode == "instrumental":
            chosen = parse_stems(stems)
            prepare_separation(chosen, submix=submix, model=None)
        elif stems or submix:
            raise ValueError("Stems are only available for an instrumental download.")
        validate_source_url(url)
        job_id = uuid.uuid4().hex
        directory = self.root / job_id
        directory.mkdir(parents=True, exist_ok=False)
        log_path = directory / "log.txt"
        log_path.touch()
        with self.lock:
            self.jobs[job_id] = {
                "status": "queued",
                "directory": directory,
                "log_path": log_path,
            }
        thread = threading.Thread(
            target=self.run,
            args=(job_id, command_for(mode, url, directory, audio_format, chosen, submix), log_path),
            daemon=True,
        )
        thread.start()
        snapshot = self.snapshot(job_id)
        if snapshot is None:
            raise RuntimeError("Job disappeared after it was created.")
        return snapshot

    def set_status(self, job_id: str, status: str) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is not None:
                job["status"] = status

    def run(self, job_id: str, cmd: list[str], log_path: Path) -> None:
        self.set_status(job_id, "running")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        with log_path.open("w", encoding="utf-8") as log:
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env=env,
                    cwd=ROOT,
                )
            except OSError as exc:
                log.write(f"Error: {exc}\n")
                self.set_status(job_id, "error")
                return
            if proc.stdout is None:
                self.set_status(job_id, "error")
                return
            for line in proc.stdout:
                log.write(line)
                log.flush()
            code = proc.wait()
        self.set_status(job_id, "done" if code == 0 else "error")

    def snapshot(self, job_id: str) -> dict[str, object] | None:
        if not JOB_ID.fullmatch(job_id):
            return None
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            status = str(job["status"])
            directory = job["directory"]
            log_path = job["log_path"]
        if not isinstance(directory, Path) or not isinstance(log_path, Path):
            return None
        files: list[dict[str, str]] = []
        if status in {"done", "error"}:
            files = [file_payload(job_id, directory, path) for path in list_audio(directory)]
        return {
            "id": job_id,
            "status": status,
            "log": read_log(log_path),
            "files": files,
        }

    def resolve_file(self, job_id: str, relative: str) -> Path | None:
        if not JOB_ID.fullmatch(job_id):
            return None
        if not relative or relative.startswith("/") or "\\" in relative:
            return None
        job_dir = (self.root / job_id).resolve()
        if not job_dir.is_dir():
            return None
        candidate = (job_dir / relative).resolve()
        try:
            inside = candidate.relative_to(job_dir)
        except ValueError:
            return None
        if ".demucs-work" in inside.parts:
            return None
        if not candidate.is_file():
            return None
        return candidate


class Handler(BaseHTTPRequestHandler):
    server: "CloudServer"

    def do_GET(self) -> None:
        try:
            self.route_get()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_POST(self) -> None:
        try:
            self.route_post()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def route_get(self) -> None:
        parts = self.parts()
        if not parts:
            self.send_static("index.html")
            return
        if len(parts) == 1 and parts[0] in STATIC_FILES:
            self.send_static(parts[0])
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "jobs":
            snapshot = self.server.jobs.snapshot(parts[2])
            if snapshot is None:
                self.send_json(404, {"error": "Job not found."})
                return
            self.send_json(200, snapshot)
            return
        if len(parts) >= 3 and parts[0] == "files":
            path = self.server.jobs.resolve_file(parts[1], "/".join(parts[2:]))
            if path is None:
                self.send_json(404, {"error": "File not found."})
                return
            content_type = AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream")
            self.send_file(path, content_type, path.name)
            return
        self.send_json(404, {"error": "Not found."})

    def route_post(self) -> None:
        parts = self.parts()
        if parts != ["api", "jobs"]:
            self.send_json(404, {"error": "Not found."})
            return
        payload = self.read_json()
        if payload is None:
            return
        url = payload.get("url")
        mode = payload.get("mode")
        audio_format = payload.get("format", DEFAULT_FORMAT.get(mode if isinstance(mode, str) else "", "best"))
        if not isinstance(url, str) or not url.strip():
            self.send_json(400, {"error": "A track link is required."})
            return
        if not isinstance(mode, str):
            self.send_json(400, {"error": "Mode must be track or instrumental."})
            return
        if not isinstance(audio_format, str) or not audio_format:
            self.send_json(400, {"error": "Choose a file type."})
            return
        raw_stems = payload.get("stems", None)
        submix = payload.get("submix", False)
        if raw_stems is None:
            stems = None
        elif not isinstance(raw_stems, list) or any(not isinstance(item, str) for item in raw_stems):
            self.send_json(400, {"error": "Choose stems from the list."})
            return
        else:
            stems = raw_stems
        if not isinstance(submix, bool):
            self.send_json(400, {"error": "Submix must be true or false."})
            return
        try:
            snapshot = self.server.jobs.create(url.strip(), mode, audio_format, stems, submix)
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return
        self.send_json(202, snapshot)

    def parts(self) -> list[str]:
        parsed = urlparse(self.path)
        return [unquote(part) for part in parsed.path.split("/") if part]

    def read_json(self) -> dict | None:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError:
            self.send_json(400, {"error": "Expected JSON."})
            return None
        if length < 0 or length > 65_536:
            self.send_json(400, {"error": "Expected JSON."})
            return None
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Expected JSON."})
            return None
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Expected a JSON object."})
            return None
        return payload

    def send_static(self, name: str) -> None:
        path = (WEB_ROOT / name).resolve()
        try:
            path.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self.send_json(404, {"error": "Not found."})
            return
        if not path.is_file():
            self.send_json(404, {"error": "Not found."})
            return
        self.send_file(path, STATIC_FILES[name])

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, content_type: str, download_name: str | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "no-store")
        if download_name:
            self.send_header("Content-Disposition", content_disposition(download_name))
        self.end_headers()
        with path.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class CloudServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], jobs: JobStore) -> None:
        self.jobs = jobs
        super().__init__(server_address, Handler)


def serve(host: str = "127.0.0.1", port: int = 8765) -> int:
    index = WEB_ROOT / "index.html"
    if not index.is_file():
        print(f"Error: missing {index}", file=sys.stderr)
        return 1
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    jobs = JobStore(JOBS_ROOT)
    try:
        httpd = CloudServer((host, port), jobs)
    except OSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(f"Cloud Chaser at http://{host}:{port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(serve())
