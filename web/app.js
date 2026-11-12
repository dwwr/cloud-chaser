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
const fileInput = document.querySelector("#file");
const linkSource = document.querySelector("#link-source");
const fileSource = document.querySelector("#file-source");
const fileTypes = document.querySelector("#file-types");
const fileError = document.querySelector("#file-error");

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

const uploadTypes = [
  ["wav", "WAV"],
  ["mp3", "MP3"],
  ["m4a", "M4A"],
  ["flac", "FLAC"],
  ["ogg", "OGG"],
  ["opus", "Opus"],
  ["aac", "AAC"],
  ["mp4", "MP4"],
  ["webm", "WebM"],
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
fileInput.accept = uploadTypes.map(([ext]) => "." + ext).join(",");
fileTypes.textContent = uploadTypeList();
renderFormats("track");
syncSource();

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
  syncSource();
  if (target === fileInput) {
    noteFile(fileInput.files && fileInput.files[0]);
  }
  hint.textContent = hintFor(mode);
  renderFormats(mode);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = String(new FormData(form).get("mode") || "track");
  const audioFormat = String(new FormData(form).get("format") || "");
  const fromFile = source() === "file";
  const file = fromFile && fileInput.files ? fileInput.files[0] : null;
  if (fromFile) {
    if (!file) {
      showFileError("Choose an audio file.");
      return;
    }
    if (!allowedUpload(file.name)) {
      showFileError(uploadTypeMessage());
      return;
    }
    clearFileError();
  }
  const body = { url: urlInput.value.trim(), mode, format: audioFormat };
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
    const response = await fetch("/api/jobs", fromFile ? fileRequest(file, body) : jsonRequest(body));
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
    if (source() === "file") {
      return "Saves that file. MP3, M4A, and Opus convert it.";
    }
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
  const choices = (formats[mode] || formats.track).map(([value, label]) => {
    if (value === "best" && source() === "file") {
      return [value, "Original"];
    }
    return [value, label];
  });
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

function source() {
  return String(new FormData(form).get("source") || "link");
}

function syncSource() {
  const file = source() === "file";
  linkSource.hidden = file;
  fileSource.hidden = !file;
  urlInput.disabled = file;
  urlInput.required = !file;
  fileInput.required = file;
}

function uploadLabels() {
  return uploadTypes.map(([, label]) => label);
}

function uploadTypeList() {
  return "Allowed: " + uploadLabels().join(", ") + ".";
}

function uploadTypeMessage() {
  const labels = uploadLabels();
  const last = labels[labels.length - 1];
  return "Use a " + labels.slice(0, -1).join(", ") + ", or " + last + " file.";
}

function allowedUpload(name) {
  const lower = String(name || "").toLowerCase();
  return uploadTypes.some(([ext]) => lower.endsWith("." + ext));
}

function noteFile(file) {
  if (file && !allowedUpload(file.name)) {
    showFileError(uploadTypeMessage());
    return;
  }
  clearFileError();
}

function showFileError(text) {
  fileError.hidden = false;
  fileError.textContent = text;
}

function clearFileError() {
  fileError.hidden = true;
  fileError.textContent = "";
}

function jsonRequest(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function fileRequest(file, body) {
  const data = new FormData();
  data.append("file", file);
  data.append("mode", body.mode);
  data.append("format", body.format);
  if (body.mode === "instrumental") {
    data.append("submix", body.submix ? "true" : "false");
    if (Array.isArray(body.stems)) {
      for (const stem of body.stems) {
        data.append("stems", stem);
      }
    }
  }
  return { method: "POST", body: data };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}
