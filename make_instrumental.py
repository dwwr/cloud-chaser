#!/usr/bin/env python3
"""Download a SoundCloud or YouTube track (or use a local file) and recover an instrumental via Demucs."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from soundcloud_pull import (
    DownloadFailed,
    build_ydl_opts,
    download_one,
    is_supported_url,
    validate_source_url,
)


FOUR_STEMS = ("vocals", "drums", "bass", "other")
SIX_STEMS = ("vocals", "drums", "bass", "other", "guitar", "piano")
STEM_NAMES = set(SIX_STEMS)


BANNER = """
make-instrumental — download your track, separate vocals with Demucs, save the instrumental

Only use this for tracks you uploaded or otherwise have the right to process.
Separation is an AI estimate (not true studio stems).
""".strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Download one SoundCloud or YouTube track (or use a local mix), run Demucs "
            "separation, and save an instrumental or the stems you name."
        ),
        epilog=(
            "Examples:\n"
            "  make-instrumental https://soundcloud.com/you/track-slug\n"
            "  make-instrumental https://www.youtube.com/watch?v=VIDEO_ID\n"
            "  make-instrumental --stems vocals --submix URL\n"
            "  make-instrumental --stems drums --stems bass URL\n"
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
        default=None,
        help="Demucs model (default: htdemucs, or htdemucs_6s when guitar or piano is requested)",
    )
    parser.add_argument(
        "--stems",
        action="append",
        choices=SIX_STEMS,
        help="Stem to save. Repeat for more than one. Default: one instrumental",
    )
    parser.add_argument(
        "--submix",
        action="store_true",
        help="Also save a mix of the stems that were not selected",
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


def parse_stems(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    chosen: list[str] = []
    for value in values:
        name = value.strip().lower()
        if name not in STEM_NAMES:
            raise ValueError(f"Unknown stem: {value}")
        if name not in chosen:
            chosen.append(name)
    if not chosen:
        raise ValueError("Select at least one stem.")
    return chosen


def prepare_separation(
    stems: list[str] | None,
    *,
    submix: bool,
    model: str | None,
) -> tuple[str, bool, tuple[str, ...]]:
    chosen = set(stems or [])
    if stems is not None and not chosen:
        raise ValueError("Select at least one stem.")
    fine = bool(chosen & {"guitar", "piano"})
    two_stems = stems is None or chosen == {"vocals"}
    if model:
        resolved = model
    elif fine:
        resolved = "htdemucs_6s"
    else:
        resolved = "htdemucs"
    if two_stems:
        produced: tuple[str, ...] = ()
    elif resolved == "htdemucs_6s" or fine:
        produced = SIX_STEMS
    else:
        produced = FOUR_STEMS
    if submix and produced and chosen >= set(produced):
        raise ValueError("Submix needs at least one stem left unselected.")
    return resolved, two_stems, produced


def demucs_argv(
    *,
    mix_path: Path,
    work_dir: Path,
    model: str,
    device: str | None,
    mp3: bool,
    two_stems: bool,
) -> list[str]:
    args: list[str] = []
    if two_stems:
        args.extend(["--two-stems", "vocals"])
    args.extend(["-n", model, "-o", str(work_dir)])
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


def place_audio(src: Path, dest: Path, *, mp3: bool) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not mp3 or src.suffix.lower() == ".mp3":
        shutil.copy2(src, dest)
        return
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(src),
                "-codec:a",
                "libmp3lame",
                "-q:a",
                "0",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError as exc:
        raise FileNotFoundError("ffmpeg is required to write MP3 stems.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise OSError(detail or "ffmpeg could not encode that stem.") from exc


def mix_wavs(sources: list[Path], dest: Path) -> None:
    if len(sources) == 1:
        shutil.copy2(sources[0], dest)
        return
    command = ["ffmpeg", "-y"]
    for source in sources:
        command.extend(["-i", str(source)])
    command.extend(
        [
            "-filter_complex",
            f"amix=inputs={len(sources)}:duration=longest:dropout_transition=0:normalize=0",
            str(dest),
        ]
    )
    try:
        subprocess.run(command, check=True, capture_output=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError("ffmpeg is required to mix stems.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise OSError(detail or "ffmpeg could not mix those stems.") from exc


def save_outputs(
    *,
    mix_path: Path,
    work_dir: Path,
    instrumental_dir: Path,
    model: str,
    mp3: bool,
    keep_stems: bool,
    stems: list[str] | None,
    submix: bool,
    two_stems: bool,
    produced: tuple[str, ...],
) -> list[Path]:
    instrumental_dir.mkdir(parents=True, exist_ok=True)
    ext = ".mp3" if mp3 else ".wav"
    demucs_mp3 = mp3 and two_stems
    written: list[Path] = []

    def emit(src: Path, label: str, encode: bool) -> None:
        dest = instrumental_dir / f"{mix_path.stem} {label}{ext}"
        place_audio(src, dest, mp3=encode)
        written.append(dest)

    if stems is None:
        emit(find_stem(work_dir, model, mix_path, "no_vocals", demucs_mp3), "instrumental", False)
        if keep_stems:
            emit(find_stem(work_dir, model, mix_path, "vocals", demucs_mp3), "vocals", False)
        if submix:
            emit(find_stem(work_dir, model, mix_path, "vocals", demucs_mp3), "submix", False)
        return written

    if two_stems:
        emit(find_stem(work_dir, model, mix_path, "vocals", demucs_mp3), "vocals", False)
        if submix:
            emit(find_stem(work_dir, model, mix_path, "no_vocals", demucs_mp3), "submix", False)
        return written

    for name in stems:
        emit(find_stem(work_dir, model, mix_path, name, False), name, mp3)
    if submix:
        leftovers = [name for name in produced if name not in set(stems)]
        wavs = [find_stem(work_dir, model, mix_path, name, False) for name in leftovers]
        mixed = work_dir / "submix.wav"
        mix_wavs(wavs, mixed)
        emit(mixed, "submix", mp3)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.quiet:
        print(BANNER)
        print()

    try:
        chosen = parse_stems(args.stems)
        model, two_stems, produced = prepare_separation(
            chosen,
            submix=args.submix,
            model=args.model,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

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
    demucs_mp3 = args.mp3 and two_stems
    demucs_args = demucs_argv(
        mix_path=mix_path,
        work_dir=work_dir,
        model=model,
        device=args.device,
        mp3=demucs_mp3,
        two_stems=two_stems,
    )

    if not args.quiet:
        print(f"Mix: {mix_path}")
        if two_stems:
            print(f"Running Demucs ({model}, two-stems=vocals)…")
        else:
            names = ", ".join(chosen or [])
            print(f"Running Demucs ({model}, stems={names})…")

    try:
        run_demucs(demucs_args)
        written = save_outputs(
            mix_path=mix_path,
            work_dir=work_dir,
            instrumental_dir=instrumental_dir,
            model=model,
            mp3=args.mp3,
            keep_stems=args.keep_stems,
            stems=chosen,
            submix=args.submix,
            two_stems=two_stems,
            produced=produced,
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

    if args.quiet:
        for path in written:
            print(path)
    else:
        for path in written:
            print(f"Saved: {path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
