# Cloud Chaser

Download tracks you uploaded, or otherwise have the right to download, from a music streaming link. 
Make instrumentals, split stems, export to different file types for remixing and sampling.

**Only use this for tracks you uploaded or otherwise have the right to download.** Do not use it to take other people's music without permission.

| splash | main | stem splitter |
|---|---|---|
|<img width="1280" height="1508" alt="cloud-chaser-splash" src="https://github.com/user-attachments/assets/f54df2b7-fafc-4b9c-9313-989b0b5bb850" /> |<img width="1280" height="1508" alt="cloud-chaser-main" src="https://github.com/user-attachments/assets/522daa23-6456-4f77-b482-4a3d51c54b71" />|<img width="1280" height="2208" alt="cloud-chaser-stems" src="https://github.com/user-attachments/assets/74440ef4-abac-46aa-b3cc-215910fbfc24" /> |

## Mac app

**Mac (Apple silicon)** 
1. download `Cloud.Chaser-1.1.1-arm64-mac.zip`
2. unzip, drag .app to applications folder
3. try to open it- it will fail, don't move to trash
4. open Settings -> Privacy & Security, scroll to Security at bottom, and update "Allow applications from" -> App Store & Known Developers
5. Try to open again, then allow the application from that same part of the security section
6. First launch installs necessary dependencies & tools.
   
The first launch can take a while. Cloud Chaser installs its tools, the stem models, and ffmpeg. Later launches skip anything already installed.

## Command line

The same release page has `cloud-chaser-cli-1.1.1.zip`. You can also use a checkout of this repository. The commands need Python 3.10 or newer.

```bash
unzip cloud-chaser-cli-1.1.1.zip -d cloud-chaser
cd cloud-chaser
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

Install Demucs too when you want instrumentals. This download is large.

```bash
pip install -e ".[instrumental]"
```

ffmpeg is required only when you convert audio to mp3, m4a, or opus.

`pip install -e .` adds the `cloud-chaser` command. From a checkout, `python cli.py` runs the same commands.

```bash
cloud-chaser run
cloud-chaser pull "music streaming link"
cloud-chaser track "music streaming link"
cloud-chaser instrumental "music streaming link"
```

`run` opens the local web app at http://127.0.0.1:8765. `serve` does the same thing. `pull` downloads a profile, a playlist, or one track. `track` downloads one track, or saves a local audio file. `instrumental` downloads one track and saves an instrumental.

Pass `--help` after a command to see its flags. Quote a link in zsh, because `?` is a glob.

```bash
cloud-chaser track --help
cloud-chaser track -o ./recovered --format mp3 "music streaming link"
cloud-chaser pull --dry-run --limit 5 "music streaming link"
cloud-chaser pull --cookies-from-browser chrome "music streaming link"
cloud-chaser instrumental "./downloads/track.mp3"
```

Downloaded files land under `./downloads/<uploader>/<title> [<id>].<ext>`, plus a `.info.json` file. Existing files are left in place. An instrumental is written under `./instrumentals/`.

Separation is an AI estimate, not a studio stem. Dense mixes can leave vocal bleed. Quality also depends on what the service still hosts for that upload.

## Work on the web app

```bash
cd frontend
npm run dev:all
```

That starts the Python server at http://127.0.0.1:8765 and the Next.js app at http://127.0.0.1:3000.
