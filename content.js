/**
 * content.js
 * Injected into every youtube.com page.
 * Responsibilities:
 *   - Detect video navigation (SPA-safe)
 *   - Decide if video is "learning" (whitelist or manual tag)
 *   - Measure active watch time only (pauses on tab hide / video pause / idle)
 *   - Flush completed sessions to background.js
 */

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  videoId: null,
  title: null,
  channel: null,
  durationSeconds: 0,
  isLearning: false,
  autoApproved: false,
  manuallyTagged: false,
  watchSeconds: 0,
  timerInterval: null,
  sessionStart: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("v");
}

function getVideoTitle() {
  return (
    document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string")?.textContent?.trim() ||
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
    document.title.replace(" - YouTube", "").trim()
  );
}

function getChannelName() {
  return (
    document.querySelector("ytd-channel-name yt-formatted-string a")?.textContent?.trim() ||
    document.querySelector("#channel-name a")?.textContent?.trim() ||
    document.querySelector("ytd-video-owner-renderer ytd-channel-name")?.textContent?.trim() ||
    "Unknown Channel"
  );
}

function getVideoDuration() {
  const video = document.querySelector("video.html5-main-video");
  return video ? Math.round(video.duration) || 0 : 0;
}

function isVideoPlaying() {
  const video = document.querySelector("video.html5-main-video");
  return video ? !video.paused && !video.ended : false;
}

function isOnWatchPage() {
  return window.location.pathname === "/watch" && !!getVideoId();
}

// ─── Whitelist check ──────────────────────────────────────────────────────────

async function isChannelWhitelisted(channelName) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["whitelistedChannels"], (result) => {
      const list = result.whitelistedChannels || [];
      const normalised = channelName.toLowerCase().trim();
      resolve(list.some((c) => c.toLowerCase().trim() === normalised));
    });
  });
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  if (state.timerInterval) return;
  state.timerInterval = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      isVideoPlaying()
    ) {
      state.watchSeconds += 1;
      updateOverlayTimer();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ─── Session flush ────────────────────────────────────────────────────────────

function flushSession() {
  if (!state.isLearning || state.watchSeconds < 10) {
    resetState();
    return;
  }

  const session = {
    timestamp: new Date().toISOString(),
    videoId: state.videoId,
    title: state.title,
    channel: state.channel,
    watchSeconds: state.watchSeconds,
    videoDurationSeconds: state.durationSeconds,
    autoApproved: state.autoApproved,
    manuallyTagged: state.manuallyTagged,
  };

  chrome.runtime.sendMessage({ type: "LOG_SESSION", session });
  console.log("[Upskill] Session logged:", session);
  resetState();
}

function resetState() {
  stopTimer();
  state.videoId = null;
  state.title = null;
  state.channel = null;
  state.durationSeconds = 0;
  state.isLearning = false;
  state.autoApproved = false;
  state.manuallyTagged = false;
  state.watchSeconds = 0;
  state.sessionStart = null;
}

// ─── Overlay UI ───────────────────────────────────────────────────────────────

function injectOverlay() {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = "upskill-overlay";
  overlay.innerHTML = `
    <div id="upskill-badge">
      <span id="upskill-icon">📚</span>
      <span id="upskill-label">Track as learning?</span>
      <button id="upskill-yes">Yes, track</button>
      <button id="upskill-dismiss">✕</button>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "upskill-styles";
  style.textContent = `
    #upskill-overlay {
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #upskill-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0f0f0f;
      border: 1px solid #3ea6ff;
      border-radius: 12px;
      padding: 10px 14px;
      color: #fff;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(62,166,255,0.25);
      animation: upskill-slide-in 0.3s ease;
    }
    @keyframes upskill-slide-in {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    #upskill-icon { font-size: 16px; }
    #upskill-label { color: #aaa; }
    #upskill-yes {
      background: #3ea6ff;
      color: #0f0f0f;
      border: none;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    #upskill-yes:hover { background: #65b8ff; }
    #upskill-dismiss {
      background: transparent;
      border: none;
      color: #888;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 4px;
      line-height: 1;
    }
    #upskill-dismiss:hover { color: #fff; }
    #upskill-tracking-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0f0f0f;
      border: 1px solid #2ecc71;
      border-radius: 12px;
      padding: 8px 14px;
      color: #2ecc71;
      font-size: 13px;
      font-weight: 500;
    }
    #upskill-timer { font-variant-numeric: tabular-nums; }
    .upskill-pulse {
      width: 8px; height: 8px;
      background: #2ecc71;
      border-radius: 50%;
      animation: upskill-pulse 1.5s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes upskill-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(0.75); }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  document.getElementById("upskill-yes").addEventListener("click", () => {
    state.isLearning = true;
    state.manuallyTagged = true;
    showTrackingBadge();
    startTimer();
  });

  document.getElementById("upskill-dismiss").addEventListener("click", removeOverlay);
}

function showAutoApprovedBadge() {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = "upskill-overlay";
  overlay.innerHTML = `
    <div id="upskill-tracking-badge">
      <div class="upskill-pulse"></div>
      <span>Tracking</span>
      <span id="upskill-timer">0:00</span>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showTrackingBadge() {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = "upskill-overlay";
  overlay.innerHTML = `
    <div id="upskill-tracking-badge">
      <div class="upskill-pulse"></div>
      <span>Tracking</span>
      <span id="upskill-timer">0:00</span>
    </div>
  `;

  const existingStyle = document.getElementById("upskill-styles");
  if (!existingStyle) {
    const style = document.createElement("style");
    style.id = "upskill-styles";
    style.textContent = `
      #upskill-overlay { position:fixed;bottom:80px;right:24px;z-index:9999;font-family:-apple-system,sans-serif; }
      #upskill-tracking-badge { display:flex;align-items:center;gap:8px;background:#0f0f0f;border:1px solid #2ecc71;border-radius:12px;padding:8px 14px;color:#2ecc71;font-size:13px;font-weight:500; }
      #upskill-timer { font-variant-numeric:tabular-nums; }
      .upskill-pulse { width:8px;height:8px;background:#2ecc71;border-radius:50%;animation:upskill-pulse 1.5s ease-in-out infinite;flex-shrink:0; }
      @keyframes upskill-pulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.75)} }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
}

function updateOverlayTimer() {
  const el = document.getElementById("upskill-timer");
  if (!el) return;
  const m = Math.floor(state.watchSeconds / 60);
  const s = state.watchSeconds % 60;
  el.textContent = `${m}:${s.toString().padStart(2, "0")}`;
}

function removeOverlay() {
  document.getElementById("upskill-overlay")?.remove();
}

// ─── Navigation handler ───────────────────────────────────────────────────────

async function onNavigate() {
  // Flush previous session if there was one
  if (state.videoId) flushSession();

  if (!isOnWatchPage()) return;

  // Wait a tick for YouTube's DOM to settle after SPA navigation
  await new Promise((r) => setTimeout(r, 1200));

  const videoId = getVideoId();
  if (!videoId) return;

  state.videoId = videoId;
  state.sessionStart = new Date().toISOString();
  state.watchSeconds = 0;

  // Populate metadata (retry a couple times for slow renders)
  let attempts = 0;
  const populateMeta = setInterval(() => {
    attempts++;
    state.title = getVideoTitle();
    state.channel = getChannelName();
    state.durationSeconds = getVideoDuration();

    if ((state.title && state.channel !== "Unknown Channel") || attempts > 5) {
      clearInterval(populateMeta);
    }
  }, 800);

  // Check whitelist
  await new Promise((r) => setTimeout(r, 1000));
  state.channel = getChannelName();
  state.title = getVideoTitle();

  const whitelisted = await isChannelWhitelisted(state.channel);

  if (whitelisted) {
    state.isLearning = true;
    state.autoApproved = true;
    showAutoApprovedBadge();
    startTimer();
  } else {
    injectOverlay();
    // Auto-dismiss tag prompt after 15s if not acted on
    setTimeout(() => {
      if (!state.isLearning) removeOverlay();
    }, 15000);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// YouTube SPA navigation — most reliable event YouTube fires itself
window.addEventListener("yt-navigate-finish", onNavigate);

// Fallback: popstate for back/forward
window.addEventListener("popstate", onNavigate);

// Pause timer when tab is hidden
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.isLearning) {
    // Timer naturally pauses because isVideoPlaying() check in interval handles it
    // But we also flush if tab is hidden for more than 5 minutes (handled by alarm in background)
    chrome.runtime.sendMessage({
      type: "TAB_HIDDEN",
      videoId: state.videoId,
      watchSeconds: state.watchSeconds,
    });
  }
});

// Flush on page unload
window.addEventListener("beforeunload", () => {
  if (state.isLearning && state.watchSeconds > 10) flushSession();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

// Run on initial load (e.g. direct navigation to /watch URL)
if (isOnWatchPage()) {
  onNavigate();
}
