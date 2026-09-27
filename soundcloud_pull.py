#!/usr/bin/env python3
"""Pull audio from SoundCloud for tracks you own or have rights to download."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError


BANNER = """
soundcloud-pull — recover audio from your SoundCloud uploads

Only use this for tracks you uploaded or otherwise have the right to download.
SoundCloud's terms restrict downloading other people's content without permission.
""".strip()


class DownloadFailed(Exception):
    """Raised when yt-dlp cannot download or resolve a track."""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download your SoundCloud tracks (profile or single track URL).",
        epilog=(
            "Examples:\n"
            "  soundcloud-pull https://soundcloud.com/your-username\n"
            "  soundcloud-pull https://soundcloud.com/your-username/track-name\n"
            "  soundcloud-pull -o ./recovered https://soundcloud.com/your-username\n"
            "  soundcloud-pull --cookies cookies.txt https://soundcloud.com/you/private-track\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "url",
        help="SoundCloud profile URL, likes URL, playlist URL, or single track URL",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="./downloads",
        help="Directory to save files (default: ./downloads)",
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
        help="Netscape cookies file for private / geo-restricted tracks (export from your browser)",
    )
    parser.add_argument(
        "--cookies-from-browser",
        metavar="BROWSER",
        help="Load cookies from a local browser (e.g. chrome, firefox, brave) for private tracks",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Only download the first N items from a profile or playlist",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be downloaded without writing files",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Less verbose output",
    )
    return parser


def output_template(output_dir: Path) -> str:
    # Artist / title when available; fall back to id so names stay unique.
    return str(
        output_dir
        / "%(uploader|Unknown)s"
        / "%(title)s [%(id)s].%(ext)s"
    )


def build_ydl_opts(
    *,
    output_dir: Path,
    audio_format: str,
    cookies: str | None,
    cookies_from_browser: str | None,
    limit: int | None,
    dry_run: bool,
    quiet: bool,
) -> dict:
    opts: dict = {
        "outtmpl": output_template(output_dir),
        "noplaylist": False,
        "ignoreerrors": False,
        "retries": 3,
        "fragment_retries": 3,
        "quiet": quiet,
        "no_warnings": quiet,
        "writethumbnail": False,
        "writeinfojson": True,
        "overwrites": False,
        "continue_dl": True,
        # Prefer original / highest quality progressive streams when SoundCloud exposes them.
        "format": "bestaudio/best",
    }

    if dry_run:
        opts["simulate"] = True
        opts["skip_download"] = True

    if cookies and cookies_from_browser:
        raise ValueError("Use either --cookies or --cookies-from-browser, not both.")

    if cookies:
        cookie_path = Path(cookies)
        if not cookie_path.is_file():
            raise FileNotFoundError(f"Cookies file not found: {cookie_path}")
        opts["cookiefile"] = str(cookie_path)

    if cookies_from_browser:
        # yt-dlp expects a tuple like ("chrome",) or ("chrome", "Profile 1", None)
        opts["cookiesfrombrowser"] = (cookies_from_browser.strip().lower(),)

    if limit is not None:
        if limit < 1:
            raise ValueError("--limit must be at least 1")
        opts["playlistend"] = limit

    if audio_format != "best":
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": audio_format,
                "preferredquality": "0",
            }
        ]
        # Keep original if extract fails rather than aborting the whole run.
        opts["keepvideo"] = False

    return opts


def validate_soundcloud_url(url: str) -> None:
    lowered = url.strip().lower()
    if "soundcloud.com" not in lowered and "on.soundcloud.com" not in lowered:
        raise ValueError(
            "URL does not look like SoundCloud. Pass a soundcloud.com profile or track link."
        )


def is_soundcloud_url(value: str) -> bool:
    lowered = value.strip().lower()
    return "soundcloud.com" in lowered or "on.soundcloud.com" in lowered


def resolve_downloaded_path(ydl: YoutubeDL, info: dict) -> Path:
    """Resolve the on-disk path for a single downloaded (or simulated) entry."""
    requested = info.get("requested_downloads") or []
    if requested:
        filepath = requested[0].get("filepath")
        if filepath:
            return Path(filepath)

    filepath = info.get("filepath") or info.get("_filename")
    if filepath:
        return Path(filepath)

    prepared = Path(ydl.prepare_filename(info))
    # After FFmpegExtractAudio the extension may have changed.
    if not prepared.is_file():
        for candidate in prepared.parent.glob(prepared.stem + ".*"):
            if candidate.suffix.lower() not in {".json", ".description", ".jpg", ".png", ".webp"}:
                return candidate
    return prepared


def download_one(url: str, opts: dict) -> Path:
    """Download a single SoundCloud track and return its file path.

    Raises DownloadFailed on network/extract errors, ValueError for playlists/profiles.
    """
    single_opts = dict(opts)
    # Prefer failing early on multi-item pages when a single track is required.
    single_opts["noplaylist"] = True

    with YoutubeDL(single_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=not single_opts.get("simulate"))
        except DownloadError as exc:
            raise DownloadFailed(str(exc)) from exc

        if info is None:
            raise DownloadFailed("Nothing found at that URL.")

        entries = info.get("entries")
        if entries is not None:
            items = [e for e in entries if e]
            if len(items) == 0:
                raise DownloadFailed("Nothing found at that URL.")
            if len(items) > 1:
                raise ValueError(
                    "Expected a single track URL, but got a profile/playlist. "
                    "Pass one track link (…/artist/track-slug)."
                )
            info = items[0]
            if not single_opts.get("simulate"):
                # When noplaylist still yields one entry dict without a download, fetch it.
                if not info.get("requested_downloads") and not info.get("filepath"):
                    info = ydl.extract_info(
                        info.get("webpage_url") or info.get("url") or url,
                        download=True,
                    )

        path = resolve_downloaded_path(ydl, info)
        if not single_opts.get("simulate") and not path.is_file():
            raise DownloadFailed(f"Download finished but file not found: {path}")
        return path


def download(url: str, opts: dict) -> int:
    with YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=not opts.get("simulate"))
        except DownloadError as exc:
            print(f"Download failed: {exc}", file=sys.stderr)
            print(
                "\nTips:\n"
                "  • Confirm the URL opens in your browser while logged in.\n"
                "  • For private tracks, export cookies and pass --cookies.\n"
                "  • Install ffmpeg if you requested --format mp3/m4a/opus.",
                file=sys.stderr,
            )
            return 1

        if info is None:
            print("Nothing found at that URL.", file=sys.stderr)
            return 1

        entries = info.get("entries")
        if entries is not None:
            # Materialize generator so we can count without consuming twice.
            items = [e for e in entries if e]
            print(f"Found {len(items)} item(s).")
            if opts.get("simulate"):
                for i, entry in enumerate(items, start=1):
                    title = entry.get("title") or entry.get("id") or "unknown"
                    uploader = entry.get("uploader") or "?"
                    print(f"  {i}. {uploader} — {title}")
        else:
            title = info.get("title") or info.get("id") or "unknown"
            if opts.get("simulate"):
                print(f"Would download: {title}")
            else:
                print(f"Downloaded: {title}")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.quiet:
        print(BANNER)
        print()

    try:
        validate_soundcloud_url(args.url)
        output_dir = Path(args.output_dir).expanduser().resolve()
        if not args.dry_run:
            output_dir.mkdir(parents=True, exist_ok=True)

        opts = build_ydl_opts(
            output_dir=output_dir,
            audio_format=args.format,
            cookies=args.cookies,
            cookies_from_browser=args.cookies_from_browser,
            limit=args.limit,
            dry_run=args.dry_run,
            quiet=args.quiet,
        )
    except (ValueError, FileNotFoundError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if not args.quiet:
        mode = "Dry run" if args.dry_run else "Saving to"
        print(f"{mode}: {output_dir}")
        print(f"URL: {args.url}\n")

    return download(args.url, opts)


if __name__ == "__main__":
    raise SystemExit(main())
