#!/usr/bin/env python3
"""Download a SoundCloud or YouTube track (or use a local file) and recover an instrumental via Demucs."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from soundcloud_pull import (
    DownloadFailed,
    build_ydl_opts,
    download_one,
    is_supported_url,
    validate_source_url,
)


BANNER = """
make-instrumental — download your track, separate vocals with Demucs, save the instrumental

Only use this for tracks you uploaded or otherwise have the right to process.
Separation is an AI estimate (not true studio stems).
""".strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Download one SoundCloud or YouTube track (or use a local mix), run Demucs "
            "two-stem separation, and save the instrumental (no_vocals)."
        ),
        epilog=(
            "Examples:\n"
            "  make-instrumental https://soundcloud.com/you/track-slug\n"
            "  make-instrumental https://www.youtube.com/watch?v=VIDEO_ID\n"
            "  make-instrumental ./downloads/You/Track\\ [id].mp3\n"
            "  make-instrumental --cookies-from-browser chrome URL\n"
            "  make-instrumental --device cpu --mp3 URL\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "source",
        help="SoundCloud or YouTube track URL, or a path to a local audio file",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="./downloads",
        help="Directory for downloaded mixes (default: ./downloads)",
    )
    parser.add_argument(
        "--instrumental-dir",
        default="./instrumentals",
        help="Directory for the final instrumental (default: ./instrumentals)",
    )
    parser.add_argument(
        "--model",
        default="htdemucs",
        help="Demucs model name (default: htdemucs)",
    )
    parser.add_argument(
        "--device",
        choices=("cpu", "cuda"),
        default=None,
        help="Force Demucs device (default: Demucs auto-detect)",
    )
    parser.add_argument(
        "--mp3",
        action="store_true",
        help="Write Demucs stems / instrumental as MP3 instead of WAV",
    )
    parser.add_argument(
        "--keep-stems",
        action="store_true",
        help="Also copy vocals.wav (or .mp3) next to the instrumental",
    )
    parser.add_argument(
        "--cookies",
        metavar="FILE",
        help="Netscape cookies file for private / original-format downloads",
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


def resolve_mix_path(
    source: str,
    *,
    output_dir: Path,
    cookies: str | None,
    cookies_from_browser: str | None,
    quiet: bool,
) -> Path:
    local = Path(source).expanduser()
    if local.is_file():
        return local.resolve()

    if not is_supported_url(source):
        raise ValueError(
            f"Not a local file or a SoundCloud or YouTube URL: {source}\n"
            "Pass a track URL or an existing audio file path."
        )

    validate_source_url(source)
    output_dir.mkdir(parents=True, exist_ok=True)
    opts = build_ydl_opts(
        output_dir=output_dir,
        audio_format="best",
        cookies=cookies,
        cookies_from_browser=cookies_from_browser,
        limit=None,
        dry_run=False,
        quiet=quiet,
    )
    path = download_one(source, opts)
    if not quiet:
        print(f"Downloaded: {path}")
    return path


def demucs_argv(
    *,
    mix_path: Path,
    work_dir: Path,
    model: str,
    device: str | None,
    mp3: bool,
) -> list[str]:
    args = [
        "--two-stems",
        "vocals",
        "-n",
        model,
        "-o",
        str(work_dir),
    ]
    if device:
        args.extend(["-d", device])
    if mp3:
        args.append("--mp3")
    args.append(str(mix_path))
    return args


def find_stem(work_dir: Path, model: str, mix_path: Path, stem: str, mp3: bool) -> Path:
    ext = ".mp3" if mp3 else ".wav"
    track_dir = work_dir / model / mix_path.stem
    candidate = track_dir / f"{stem}{ext}"
    if candidate.is_file():
        return candidate

    # Demucs sometimes sanitizes the folder name; search under the model dir.
    model_dir = work_dir / model
    if model_dir.is_dir():
        matches = sorted(model_dir.glob(f"*/{stem}{ext}"))
        if len(matches) == 1:
            return matches[0]
        if matches:
            # Prefer the newest match when multiple exist.
            return max(matches, key=lambda p: p.stat().st_mtime)

    raise FileNotFoundError(
        f"Demucs finished but {stem}{ext} was not found under {model_dir}"
    )


def run_demucs(argv: list[str]) -> None:
    try:
        import demucs.separate
    except ImportError as exc:
        raise ImportError(
            "demucs (and its deps) are not installed. Install with:\n"
            '  pip install -e ".[instrumental]"\n'
            "or:\n"
            "  pip install -r requirements-instrumental.txt\n"
            f"Underlying error: {exc}"
        ) from exc

    demucs.separate.main(argv)


def save_instrumental(
    *,
    mix_path: Path,
    work_dir: Path,
    instrumental_dir: Path,
    model: str,
    mp3: bool,
    keep_stems: bool,
    quiet: bool,
) -> Path:
    instrumental_dir.mkdir(parents=True, exist_ok=True)
    ext = ".mp3" if mp3 else ".wav"
    no_vocals = find_stem(work_dir, model, mix_path, "no_vocals", mp3)
    dest = instrumental_dir / f"{mix_path.stem} instrumental{ext}"
    shutil.copy2(no_vocals, dest)

    if keep_stems:
        vocals = find_stem(work_dir, model, mix_path, "vocals", mp3)
        vocals_dest = instrumental_dir / f"{mix_path.stem} vocals{ext}"
        shutil.copy2(vocals, vocals_dest)
        if not quiet:
            print(f"Vocals stem: {vocals_dest}")

    return dest


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.quiet:
        print(BANNER)
        print()

    output_dir = Path(args.output_dir).expanduser().resolve()
    instrumental_dir = Path(args.instrumental_dir).expanduser().resolve()
    work_dir = instrumental_dir / ".demucs-work"

    try:
        mix_path = resolve_mix_path(
            args.source,
            output_dir=output_dir,
            cookies=args.cookies,
            cookies_from_browser=args.cookies_from_browser,
            quiet=args.quiet,
        )
    except (ValueError, FileNotFoundError, DownloadFailed) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if isinstance(exc, DownloadFailed):
            print(
                "\nTips:\n"
                "  • Use a single track URL, not a profile or playlist.\n"
                "  • For private tracks, pass --cookies or --cookies-from-browser.",
                file=sys.stderr,
            )
        return 2

    work_dir.mkdir(parents=True, exist_ok=True)
    demucs_args = demucs_argv(
        mix_path=mix_path,
        work_dir=work_dir,
        model=args.model,
        device=args.device,
        mp3=args.mp3,
    )

    if not args.quiet:
        print(f"Mix: {mix_path}")
        print(f"Running Demucs ({args.model}, two-stems=vocals)…")

    try:
        run_demucs(demucs_args)
        dest = save_instrumental(
            mix_path=mix_path,
            work_dir=work_dir,
            instrumental_dir=instrumental_dir,
            model=args.model,
            mp3=args.mp3,
            keep_stems=args.keep_stems,
            quiet=args.quiet,
        )
    except ImportError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except (FileNotFoundError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except SystemExit as exc:
        # demucs.separate.main may call sys.exit on failure
        code = exc.code if isinstance(exc.code, int) else 1
        if code:
            print("Demucs failed.", file=sys.stderr)
            return code
        return 0

    if not args.quiet:
        print(f"Instrumental saved: {dest}")
    else:
        print(dest)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
