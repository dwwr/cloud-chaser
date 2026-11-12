const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const submitButton = document.querySelector("#submit");
const hint = document.querySelector("#hint");
const result = document.querySelector("#result");
const statusEl = document.querySelector("#status");
const filesEl = document.querySelector("#files");
const logEl = document.querySelector("#log");

const formatSelect = document.querySelector("#format");

const hints = {
  track: "Saves the audio file for that track.",
  instrumental: "Separates vocals locally. This can take several minutes.",
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

let ticket = 0;

renderFormats("track");

form.addEventListener("change", () => {
  const mode = String(new FormData(form).get("mode") || "track");
  hint.textContent = hints[mode] || "";
  renderFormats(mode);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = String(new FormData(form).get("mode") || "track");
  const audioFormat = String(new FormData(form).get("format") || "");
  const url = urlInput.value.trim();
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
      body: JSON.stringify({ url, mode, format: audioFormat }),
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
