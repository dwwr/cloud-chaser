const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const submitButton = document.querySelector("#submit");
const hint = document.querySelector("#hint");
const result = document.querySelector("#result");
const statusEl = document.querySelector("#status");
const filesEl = document.querySelector("#files");
const logEl = document.querySelector("#log");

const formatSelect = document.querySelector("#format");
const stemsPanel = document.querySelector("#stems");
const presetSelect = document.querySelector("#preset");
const stemList = document.querySelector("#stem-list");
const submixInput = document.querySelector("#submix");

const hints = {
  track: "Saves the audio file for that track.",
  instrumental: "Separates vocals locally. This can take several minutes.",
  fine: "Separation takes several minutes. Guitar and piano are the less reliable pair.",
};

const formats = {
  track: [
    ["best", "Best available"],
    ["mp3", "MP3"],
    ["m4a", "M4A"],
    ["opus", "Opus"],
  ],
  instrumental: [
    ["wav", "WAV"],
    ["mp3", "MP3"],
  ],
};

const stemNames = [
  ["vocals", "Vocals"],
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["guitar", "Guitar"],
  ["piano", "Piano"],
  ["other", "Other"],
];

const presets = {
  instrumental: ["drums", "bass", "guitar", "piano", "other"],
  vocals: ["vocals"],
  all: stemNames.map(([name]) => name),
};

let ticket = 0;

for (const [name, label] of stemNames) {
  const row = document.createElement("label");
  row.className = "stem";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "stem";
  input.value = name;
  const text = document.createElement("span");
  text.textContent = label;
  row.append(input, text);
  stemList.append(row);
}

applyPreset("instrumental");
renderFormats("track");

form.addEventListener("change", (event) => {
  const mode = String(new FormData(form).get("mode") || "track");
  const target = event.target;
  if (target === presetSelect) {
    applyPreset(presetSelect.value);
  } else if (target && target.name === "stem") {
    presetSelect.value = "custom";
  }
  syncSubmix();
  syncStemPanel(mode);
  hint.textContent = hintFor(mode);
  renderFormats(mode);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = String(new FormData(form).get("mode") || "track");
  const audioFormat = String(new FormData(form).get("format") || "");
  const url = urlInput.value.trim();
  const body = { url, mode, format: audioFormat };
  if (mode === "instrumental") {
    body.submix = submixInput.checked;
    if (presetSelect.value !== "instrumental") {
      body.stems = checkedStems();
    }
  }
  ticket += 1;
  const mine = ticket;
  result.hidden = false;
  filesEl.replaceChildren();
  logEl.hidden = true;
  logEl.textContent = "";
  setStatus("Starting…", "running");
  submitButton.disabled = true;
  submitButton.textContent = "Working…";

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (mine !== ticket) {
      return;
    }
    if (!response.ok) {
      finish(payload.error || "Could not start.", "error");
      return;
    }
    watch(payload.id, mine);
  } catch (error) {
    if (mine !== ticket) {
      return;
    }
    finish("Could not reach the server.", "error");
  }
});

async function watch(id, mine) {
  try {
    const response = await fetch("/api/jobs/" + id);
    const job = await readJson(response);
    if (mine !== ticket) {
      return;
    }
    if (!response.ok) {
      finish(job.error || "Lost the job.", "error");
      return;
    }
    if (job.log) {
      logEl.hidden = false;
      logEl.textContent = job.log;
    }
    if (job.status === "done" || job.status === "error") {
      renderFiles(job.files || []);
      if (job.status === "done" && !(job.files || []).length) {
        finish("Finished, but no audio file was found.", "error");
        return;
      }
      finish(job.status === "done" ? "Ready" : "Failed", job.status);
      return;
    }
    setStatus(job.status === "queued" ? "Queued…" : "Working…", "running");
    window.setTimeout(() => watch(id, mine), 1000);
  } catch (error) {
    if (mine !== ticket) {
      return;
    }
    finish("Lost contact with the server.", "error");
  }
}

function renderFiles(files) {
  filesEl.replaceChildren();
  for (const file of files) {
    if (!file.url || !String(file.url).startsWith("/files/")) {
      continue;
    }
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.download = "";
    link.textContent = file.name || "Download";
    item.append(link);
    filesEl.append(item);
  }
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function finish(text, state) {
  setStatus(text, state);
  submitButton.disabled = false;
  submitButton.textContent = "Start";
}

function checkedStems() {
  return [...stemList.querySelectorAll("input:checked")].map((input) => input.value);
}

function applyPreset(name) {
  const selected = new Set(presets[name] || checkedStems());
  if (!presets[name]) {
    return;
  }
  for (const input of stemList.querySelectorAll("input")) {
    input.checked = selected.has(input.value);
  }
}

function syncSubmix() {
  const lock = presetSelect.value !== "instrumental" && checkedStems().length === stemNames.length;
  if (lock) {
    submixInput.checked = false;
  }
  submixInput.disabled = lock;
}

function syncStemPanel(mode) {
  stemsPanel.hidden = mode !== "instrumental";
}

function hintFor(mode) {
  if (mode !== "instrumental") {
    return hints.track;
  }
  const selected = checkedStems();
  if (presetSelect.value === "all" || selected.includes("guitar") || selected.includes("piano")) {
    if (presetSelect.value === "instrumental") {
      return hints.instrumental;
    }
    return hints.fine;
  }
  return hints.instrumental;
}

function renderFormats(mode) {
  const choices = formats[mode] || formats.track;
  const current = formatSelect.value;
  formatSelect.replaceChildren();
  for (const [value, label] of choices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    formatSelect.append(option);
  }
  if (choices.some(([value]) => value === current)) {
    formatSelect.value = current;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}
