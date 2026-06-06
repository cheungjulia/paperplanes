const STILL_SECONDS = 30;
const MAX_ACCURACY_METERS = 80;
const STILL_RADIUS_METERS = 25;
const MAX_SPEED_MPS = 1.2;
const GEOHASH_PRECISION = 7;
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

const els = {
  views: {
    home: document.querySelector("#home-view"),
    traces: document.querySelector("#traces-view"),
    leave: document.querySelector("#leave-view"),
  },
  presenceProgress: document.querySelector("#presence-progress"),
  meterFill: document.querySelector("#meter-fill"),
  countdownLabel: document.querySelector("#countdown-label"),
  presenceKicker: document.querySelector("#presence-kicker"),
  homeTitle: document.querySelector("#home-title"),
  presenceCopy: document.querySelector("#presence-copy"),
  traceCount: document.querySelector("#trace-count"),
  oldestLabel: document.querySelector("#oldest-label"),
  locationButton: document.querySelector("#location-button"),
  browseButton: document.querySelector("#browse-button"),
  leaveButton: document.querySelector("#leave-button"),
  archivesSection: document.querySelector("#archives-section"),
  archivesList: document.querySelector("#archives-list"),
  tracesList: document.querySelector("#traces-list"),
  emptyTraces: document.querySelector("#empty-traces"),
  traceForm: document.querySelector("#trace-form"),
  traceText: document.querySelector("#trace-text"),
  charCount: document.querySelector("#char-count"),
  saveButton: document.querySelector("#save-button"),
  toast: document.querySelector("#toast"),
};

const state = {
  anonymousUserId: getAnonymousUserId(),
  watchId: null,
  anchor: null,
  stableStartedAt: null,
  unlockedGeohash: null,
  unlockedAt: null,
  traces: [],
};

const tickTimer = window.setInterval(updatePresenceTick, 250);

els.locationButton.addEventListener("click", () => {
  if (els.locationButton.dataset.mode === "demo") {
    unlockCell(encodeGeohash(25.0330, 121.5654, GEOHASH_PRECISION));
    return;
  }
  startLocationFlow();
});
els.browseButton.addEventListener("click", async () => {
  showView("traces");
  await refreshTraces();
});
els.leaveButton.addEventListener("click", () => showView("leave"));
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
els.traceText.addEventListener("input", () => {
  els.charCount.textContent = `${els.traceText.value.length}/140`;
});
els.traceForm.addEventListener("submit", submitTrace);

bootstrap();

async function bootstrap() {
  renderLocked("Location needed", "Stand where you are", "Unlock nearby traces after a quiet moment.");
  if (!("geolocation" in navigator)) {
    renderLocationUnavailable();
    return;
  }
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "granted") {
        startLocationFlow();
      }
    } catch {
      // Some browsers throw for geolocation permission query.
    }
  }
}

function showView(name) {
  Object.entries(els.views).forEach(([viewName, el]) => {
    el.classList.toggle("is-active", viewName === name);
  });
}

function startLocationFlow() {
  if (!("geolocation" in navigator)) {
    renderLocationUnavailable();
    return;
  }
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
  }
  resetPresence();
  els.locationButton.dataset.mode = "location";
  renderLocked("Finding signal", "Stay nearby", "Waiting for a clear location fix.");
  els.locationButton.textContent = "Listening";
  els.locationButton.disabled = true;

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 12000,
    },
  );
}

function handlePosition(position) {
  if (state.unlockedGeohash) return;
  const sample = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? 999,
    speed: position.coords.speed,
    timestamp: Date.now(),
  };

  if (sample.accuracy > MAX_ACCURACY_METERS) {
    state.anchor = null;
    state.stableStartedAt = null;
    renderLocked("Finding signal", "Stay nearby", `Accuracy is about ${Math.round(sample.accuracy)}m.`);
    setProgress(0);
    return;
  }

  if (!state.anchor) {
    state.anchor = sample;
    state.stableStartedAt = Date.now();
  }

  const movedMeters = distanceMeters(state.anchor, sample);
  const movingFast = typeof sample.speed === "number" && sample.speed > MAX_SPEED_MPS;
  if (movedMeters > STILL_RADIUS_METERS || movingFast) {
    state.anchor = sample;
    state.stableStartedAt = Date.now();
  }

  updatePresenceTick();
}

function handleLocationError(error) {
  els.locationButton.disabled = false;
  els.locationButton.textContent = "Try Again";
  const message = error?.code === 1
    ? "Location permission was denied."
    : "Location is unavailable right now.";
  renderLocked("Location paused", "Current Spot", message);
  showDemoFallback();
}

function renderLocationUnavailable() {
  renderLocked("Location unavailable", "Current Spot", "Use a device or browser with location support.");
  showDemoFallback();
}

function showDemoFallback() {
  els.locationButton.textContent = "Use Demo Spot";
  els.locationButton.disabled = false;
  els.locationButton.dataset.mode = "demo";
}

function updatePresenceTick() {
  if (state.unlockedGeohash || !state.stableStartedAt) return;
  const elapsedSeconds = Math.max(0, (Date.now() - state.stableStartedAt) / 1000);
  const progress = Math.min(1, elapsedSeconds / STILL_SECONDS);
  const remaining = Math.max(0, Math.ceil(STILL_SECONDS - elapsedSeconds));
  setProgress(progress);
  els.countdownLabel.textContent = `${remaining}s`;
  renderLocked("Hold still", "Current Spot", "This place is opening.");

  if (elapsedSeconds >= STILL_SECONDS && state.anchor) {
    unlockCell(encodeGeohash(state.anchor.lat, state.anchor.lng, GEOHASH_PRECISION));
  }
}

async function unlockCell(geohash) {
  state.unlockedGeohash = geohash;
  state.unlockedAt = Date.now();
  setProgress(1);
  els.countdownLabel.textContent = "open";
  els.locationButton.textContent = "Unlocked";
  els.locationButton.disabled = true;
  els.browseButton.disabled = false;
  els.leaveButton.disabled = false;
  renderLocked("Unlocked", "Current Spot", "Anonymous traces are waiting here.");
  await refreshWall();
}

function resetPresence() {
  state.anchor = null;
  state.stableStartedAt = null;
  state.unlockedGeohash = null;
  state.unlockedAt = null;
  state.traces = [];
  els.browseButton.disabled = true;
  els.leaveButton.disabled = true;
  setProgress(0);
  els.countdownLabel.textContent = `${STILL_SECONDS}s`;
  els.traceCount.textContent = "--";
  els.oldestLabel.textContent = "--";
}

function renderLocked(kicker, title, copy) {
  els.presenceKicker.textContent = kicker;
  els.homeTitle.textContent = title;
  els.presenceCopy.textContent = copy;
}

function setProgress(progress) {
  const value = `${Math.round(progress * 100)}%`;
  els.presenceProgress.style.setProperty("--progress", value);
  els.meterFill.style.setProperty("--progress", value);
}

async function refreshWall() {
  if (!state.unlockedGeohash) return;
  const wall = await apiGet(`/api/walls/${state.unlockedGeohash}`);
  els.traceCount.textContent = String(wall.trace_count);
  els.oldestLabel.textContent = wall.oldest_trace_at ? relativeTime(wall.oldest_trace_at) : "--";
}

async function refreshTraces() {
  if (!state.unlockedGeohash) return;
  const data = await apiGet(`/api/traces?geohash=${encodeURIComponent(state.unlockedGeohash)}`);
  state.traces = data.traces ?? [];
  renderTraces();
}

function renderTraces() {
  els.archivesList.replaceChildren();
  els.tracesList.replaceChildren();
  const archival = state.traces.filter((trace) => ageDays(trace.created_at) >= 365).slice(0, 3);
  const archivalIds = new Set(archival.map((trace) => trace.id));
  const regular = state.traces.filter((trace) => !archivalIds.has(trace.id));

  els.archivesSection.hidden = archival.length === 0;
  archival.forEach((trace) => els.archivesList.appendChild(renderTrace(trace)));
  regular.forEach((trace) => els.tracesList.appendChild(renderTrace(trace)));
  els.emptyTraces.hidden = state.traces.length !== 0;
}

function renderTrace(trace) {
  const item = document.createElement("article");
  item.className = "trace-item";

  const text = document.createElement("p");
  text.className = "trace-text";
  text.textContent = trace.text;

  const meta = document.createElement("div");
  meta.className = "trace-meta";

  const timestamp = document.createElement("span");
  timestamp.textContent = `left ${relativeTime(trace.created_at)}`;

  const echo = document.createElement("button");
  echo.className = "echo-button";
  echo.type = "button";
  echo.classList.toggle("is-active", !!trace.echoed_by_me);
  echo.textContent = echoLabel(trace);
  echo.addEventListener("click", () => toggleEcho(trace));

  meta.append(timestamp, echo);
  item.append(text, meta);
  return item;
}

async function toggleEcho(trace) {
  const enabled = !trace.echoed_by_me;
  const method = enabled ? "POST" : "DELETE";
  const data = await apiFetch(`/api/traces/${trace.id}/echo`, { method });
  state.traces = state.traces.map((item) => item.id === trace.id
    ? { ...item, echo_count: data.echo_count, echoed_by_me: data.echoed_by_me }
    : item);
  renderTraces();
}

function echoLabel(trace) {
  const count = trace.echo_count ?? 0;
  if (count === 0) return "Echo";
  if (count === 1) return "1 echoed";
  return `${count} echoed`;
}

async function submitTrace(event) {
  event.preventDefault();
  if (!state.unlockedGeohash) return;
  const text = els.traceText.value.trim();
  if (!text) {
    showToast("Write something first.");
    return;
  }

  els.saveButton.disabled = true;
  try {
    await apiFetch("/api/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geohash: state.unlockedGeohash, text }),
    });
    els.traceText.value = "";
    els.charCount.textContent = "0/140";
    await Promise.all([refreshWall(), refreshTraces()]);
    showView("traces");
    showToast("Trace left.");
  } catch (error) {
    showToast(error.message || "Could not save trace.");
  } finally {
    els.saveButton.disabled = false;
  }
}

async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "X-Anonymous-User-Id": state.anonymousUserId,
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with ${response.status}`);
  }
  return data;
}

function getAnonymousUserId() {
  const key = "graffiti.anonymousUserId";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : fallbackUuid();
  window.localStorage.setItem(key, id);
  return id;
}

function fallbackUuid() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4).toString(16),
  );
}

function encodeGeohash(latitude, longitude, precision = 7) {
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  const bits = [16, 8, 4, 2, 1];
  let bitIndex = 0;
  let charValue = 0;
  let evenBit = true;
  let hash = "";

  while (hash.length < precision) {
    if (evenBit) {
      const midpoint = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= midpoint) {
        charValue |= bits[bitIndex];
        lonRange[0] = midpoint;
      } else {
        lonRange[1] = midpoint;
      }
    } else {
      const midpoint = (latRange[0] + latRange[1]) / 2;
      if (latitude >= midpoint) {
        charValue |= bits[bitIndex];
        latRange[0] = midpoint;
      } else {
        latRange[1] = midpoint;
      }
    }

    evenBit = !evenBit;
    if (bitIndex < 4) {
      bitIndex += 1;
    } else {
      hash += BASE32[charValue];
      bitIndex = 0;
      charValue = 0;
    }
  }

  return hash;
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function relativeTime(isoString) {
  const diffMs = Date.now() - Date.parse(isoString);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  if (diffMs < hour) return "just now";
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hours ago`;
  if (diffMs < month) return `${Math.floor(diffMs / day)} days ago`;
  if (diffMs < year) return `${Math.floor(diffMs / month)} months ago`;
  return `${Math.floor(diffMs / year)} years ago`;
}

function ageDays(isoString) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(isoString)) / 86_400_000));
}

let toastTimer = null;
function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2200);
}

window.addEventListener("beforeunload", () => {
  window.clearInterval(tickTimer);
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
});
