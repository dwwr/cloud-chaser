#!/usr/bin/env python3

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import make_instrumental
import soundcloud_pull
from soundcloud_pull import (
    UPLOAD_AUDIO,
    DownloadFailed,
    build_ydl_opts,
    download_one,
    is_supported_url,
    upload_type_error,
)


USAGE = """
usage: cloud-chaser <command> [args]

commands:
  run            Open the local web app
  serve          Open the local web app
  pull           Download a profile, playlist, or track
  track          Download one track
  instrumental   Download one track and save an instrumental

Run cloud-chaser <command> --help for that command's flags.
""".strip()


TRACK_BANNER = """
cloud-chaser track — download one SoundCloud or YouTube track, or save a local audio file

Only use this for tracks you uploaded or otherwise have the right to download.
SoundCloud and YouTube's terms restrict downloading other people's content without permission.
""".strip()

UPLOAD_SUFFIXES = frozenset(suffix for suffix, _label in UPLOAD_AUDIO)
TRACK_CODECS = {
    "mp3": ["-codec:a", "libmp3lame", "-q:a", "0"],
    "m4a": ["-codec:a", "aac", "-b:a", "256k"],
    "opus": ["-codec:a", "libopus", "-b:a", "192k"],
}


def build_track_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cloud-chaser track",
        description="Download one SoundCloud or YouTube track, or save a local audio file.",
        epilog=(
            "Examples:\n"
            "  cloud-chaser track https://soundcloud.com/you/track-slug\n"
            "  cloud-chaser track https://youtu.be/VIDEO_ID\n"
            "  cloud-chaser track -o ./recovered --format mp3 URL\n"
            "  cloud-chaser track -o ./recovered --format mp3 ./mix.wav\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "url",
        help="SoundCloud or YouTube track URL, or a local audio file",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="./downloads",
        help="Directory to save the file (default: ./downloads)",
    )
    parser.add_argument(
        "--format",
        choices=("best", "mp3", "m4a", "opus"),
        default="best",
        help="Preferred audio format (default: best available)",
    )
    parser.add_argument(
        "--cookies",
        metavar="FILE",
        help="Netscape cookies file for private tracks",
    )
    parser.add_argument(
        "--cookies-from-browser",
        metavar="BROWSER",
        help="Load cookies from a local browser (e.g. chrome, firefox, brave)",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Less verbose output",
    )
    return parser


def track_main(argv: list[str] | None = None) -> int:
    parser = build_track_parser()
    args = parser.parse_args(argv)

    if not args.quiet:
        print(TRACK_BANNER)
        print()

    output_dir = Path(args.output_dir).expanduser().resolve()
    local = Path(args.url).expanduser()
    try:
        if is_supported_url(args.url):
            output_dir.mkdir(parents=True, exist_ok=True)
            opts = build_ydl_opts(
                output_dir=output_dir,
                audio_format=args.format,
                cookies=args.cookies,
                cookies_from_browser=args.cookies_from_browser,
                limit=None,
                dry_run=False,
                quiet=args.quiet,
            )
            path = download_one(args.url, opts)
            saved = "Downloaded"
        elif local.is_file():
            path = save_local_track(local, output_dir, args.format)
            saved = "Saved"
        else:
            raise ValueError(
                "Not a local audio file or a SoundCloud or YouTube URL. "
                "Pass a track link or an existing audio file."
            )
    except (ValueError, FileNotFoundError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except DownloadFailed as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(
            "\nTips:\n"
            "  • Use a single track URL, not a profile or playlist.\n"
            "  • For private tracks, pass --cookies or --cookies-from-browser.",
            file=sys.stderr,
        )
        return 1

    if args.quiet:
        print(path)
    else:
        print(f"{saved}: {path}")
    return 0


def save_local_track(source: Path, output_dir: Path, audio_format: str) -> Path:
    if source.suffix.lower() not in UPLOAD_SUFFIXES:
        raise ValueError(upload_type_error())
    output_dir.mkdir(parents=True, exist_ok=True)
    if audio_format == "best" or source.suffix.lower() == f".{audio_format}":
        dest = output_dir / source.name
        shutil.copy2(source, dest)
        return dest
    codec = TRACK_CODECS.get(audio_format)
    if codec is None:
        raise ValueError("That file type is not available for this download.")
    dest = output_dir / f"{source.stem}.{audio_format}"
    command = ["ffmpeg", "-y", "-i", str(source), "-vn", *codec, str(dest)]
    try:
        subprocess.run(command, check=True, capture_output=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError("ffmpeg is required to convert that file.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise ValueError(detail[-1] if detail else "ffmpeg could not convert that file.") from exc
    return dest


def serve_main(argv: list[str] | None = None, *, prog: str = "cloud-chaser run") -> int:
    parser = argparse.ArgumentParser(
        prog=prog,
        description="Run the local web app and job server.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Address to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to listen on (default: 8765)",
    )
    args = parser.parse_args(argv)
    from server import serve

    return serve(args.host, args.port)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print(USAGE)
        return 0

    command, rest = args[0], args[1:]
    if command == "pull":
        return soundcloud_pull.main(rest)
    if command == "track":
        return track_main(rest)
    if command == "instrumental":
        return make_instrumental.main(rest)
    if command in {"run", "serve"}:
        return serve_main(rest, prog=f"cloud-chaser {command}")

    print(f"Unknown command: {command}\n\n{USAGE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
