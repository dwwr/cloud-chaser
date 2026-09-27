# soundcloud-pull

Recover audio from **your** SoundCloud uploads when you've lost the original files.

This CLI wraps [yt-dlp](https://github.com/yt-dlp/yt-dlp) so you can download a whole profile, a playlist, or a single track URL into a local folder.

**Only use this for tracks you uploaded or otherwise have the right to download.** Do not use it to take other people's music without permission.

## Requirements

- Python 3.10+
- Optional: [ffmpeg](https://ffmpeg.org/) if you want to convert to `mp3` / `m4a` / `opus`

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional: install as a console command
pip install -e .
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

## Output

Files land under `./downloads/<uploader>/<title> [<id>].<ext>` by default, plus a `.info.json` sidecar with metadata. Existing files are not overwritten.

## Notes

- Quality depends on what SoundCloud still hosts for that upload (often 128 kbps AAC/MP3 for streamed tracks — not lossless masters).
- If SoundCloud still has your original upload available in Creator Studio, prefer downloading from there first for the highest quality.
- Rate limits and site changes can break extractors; update yt-dlp (`pip install -U yt-dlp`) if downloads start failing.
