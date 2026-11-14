export default function Page() {
  return (
    <main>
      <header>
        <h1>Cloud Chaser</h1>
      </header>
      <form id="form">
        <fieldset>
          <legend>Source</legend>
          <div className="modes">
            <label className="mode">
              <input type="radio" name="source" value="link" defaultChecked />
              <span>Link</span>
            </label>
            <label className="mode">
              <input type="radio" name="source" value="file" />
              <span>File</span>
            </label>
          </div>
        </fieldset>
        <label className="field" id="link-source">
          <span>Track link</span>
          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder="Link"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div id="file-source" hidden>
          <label className="field">
            <span>Audio file</span>
            <input
              id="file"
              name="file"
              type="file"
              accept=".wav,.mp3,.m4a,.flac,.ogg,.opus,.aac,.mp4,.webm"
            />
          </label>
          <p id="file-types" className="types"></p>
          <p id="file-error" className="file-error" hidden></p>
        </div>
        <fieldset>
          <legend>Download</legend>
          <div className="modes">
            <label className="mode">
              <input type="radio" name="mode" value="track" defaultChecked />
              <span>Whole track</span>
            </label>
            <label className="mode">
              <input type="radio" name="mode" value="instrumental" />
              <span>Stems</span>
            </label>
          </div>
        </fieldset>
        <div id="stems" hidden>
          <label className="field">
            <span>Preset</span>
            <select id="preset" name="preset" defaultValue="instrumental">
              <option value="instrumental">Instrumental</option>
              <option value="vocals">Vocals</option>
              <option value="all">All stems</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <fieldset>
            <legend>Stems</legend>
            <div id="stem-list" className="stem-list"></div>
          </fieldset>
          <label className="check">
            <input id="submix" name="submix" type="checkbox" />
            <span>Submix of the stems left out</span>
          </label>
        </div>
        <label className="field format">
          <span>File type</span>
          <select id="format" name="format"></select>
        </label>
        <p id="hint">Saves the audio file for that track.</p>
        <button type="submit" id="submit">
          Start
        </button>
      </form>
      <p className="rights">
        Only use this for tracks you uploaded or otherwise have the right to
        download. Not to be used for downloading other people&apos;s content without
        permission.
      </p>
      <section id="result" hidden>
        <p id="status"></p>
        <ul id="files"></ul>
        <pre id="log" hidden></pre>
      </section>
    </main>
  );
}
