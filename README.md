# soundcloud-pull

Recover audio from **your** SoundCloud uploads when you've lost the original files.

This CLI wraps [yt-dlp](https://github.com/yt-dlp/yt-dlp) so you can download a whole profile, a playlist, or a single track URL into a local folder. An optional second script uses [Demucs](https://github.com/adefossez/demucs) to separate vocals and save an instrumental.

**Only use this for tracks you uploaded or otherwise have the right to download.** Do not use it to take other people's music without permission.

## Requirements

- Python 3.10+
- Optional: [ffmpeg](https://ffmpeg.org/) if you want to convert to `mp3` / `m4a` / `opus`
- For instrumentals: Demucs (pulls in PyTorch); a GPU helps but CPU works

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional: install as console commands
pip install -e .
```

For the instrumental script (heavier — installs Demucs + torch):

```bash
pip install -e ".[instrumental]"
# or: pip install -r requirements-instrumental.txt
```

## Usage

Download everything on your public profile:

```bash
python soundcloud_pull.py https://soundcloud.com/YOUR_USERNAME
```

One track:

```bash
python soundcloud_pull.py https://soundcloud.com/YOUR_USERNAME/track-slug
```

Choose an output folder and convert to MP3:

```bash
python soundcloud_pull.py -o ./recovered --format mp3 https://soundcloud.com/YOUR_USERNAME
```

Preview without downloading:

```bash
python soundcloud_pull.py --dry-run --limit 5 https://soundcloud.com/YOUR_USERNAME
```

### Private tracks / original files

Logged-in cookies often unlock private tracks and, when SoundCloud still has it, the original upload format:

```bash
# From an exported Netscape cookies file:
python soundcloud_pull.py --cookies cookies.txt https://soundcloud.com/YOUR_USERNAME

# Or pull cookies straight from a browser on this machine:
python soundcloud_pull.py --cookies-from-browser chrome https://soundcloud.com/YOUR_USERNAME
```

## Recover an instrumental

`make_instrumental.py` downloads **one** track (or uses a local mix), runs Demucs in two-stem mode (`--two-stems=vocals`), and saves Demucs’s `no_vocals` stem as the instrumental.

```bash
# From a SoundCloud track URL (quote it — zsh treats ? as a glob)
python make_instrumental.py "https://soundcloud.com/YOUR_USERNAME/track-slug"

# From a file you already downloaded
python make_instrumental.py "./downloads/You/Track [id].mp3"

# Private track + force CPU + keep vocals stem too
python make_instrumental.py --cookies-from-browser chrome --device cpu --keep-stems "URL"
```

Output defaults:

- Mix → `./downloads/…` (unchanged if you passed a local file)
- Instrumental → `./instrumentals/<track> instrumental.wav`
- Demucs work files → `./instrumentals/.demucs-work/`

Use `--mp3` for smaller Demucs output, `--instrumental-dir` to change the result folder, and `--model` to pick another Demucs model (default `htdemucs`).

**Quality note:** This is an AI estimate of the instrumental, not a true studio stem. Dense mixes can leave vocal bleed or artifacts. Prefer Creator Studio / project files when you still have them.

## Output

Files from `soundcloud_pull` land under `./downloads/<uploader>/<title> [<id>].<ext>` by default, plus a `.info.json` sidecar with metadata. Existing files are not overwritten.

## Notes

- Quality depends on what SoundCloud still hosts for that upload (often 128 kbps AAC/MP3 for streamed tracks — not lossless masters).
- If SoundCloud still has your original upload available in Creator Studio, prefer downloading from there first for the highest quality.
- Rate limits and site changes can break extractors; update yt-dlp (`pip install -U yt-dlp`) if downloads start failing.
