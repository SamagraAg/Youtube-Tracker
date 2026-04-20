/**
 * background.js  (Manifest V3 service worker)
 * Responsibilities:
 *   - Receive session data from content.js
 *   - Queue sessions in chrome.storage in case of auth/network failure
 *   - Authenticate with Google via chrome.identity
 *   - Write rows to Google Sheets via Sheets REST API
 *   - Retry failed writes on next alarm
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRY_ALARM = "upskill-retry";

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "LOG_SESSION") {
    handleSession(msg.session);
    sendResponse({ ok: true });
  }
  // TAB_HIDDEN is informational only — no action needed currently
  return true; // keep channel open for async
});

// ─── Core session handler ─────────────────────────────────────────────────────

async function handleSession(session) {
  console.log("[Upskill BG] Received session:", session);

  const { spreadsheetId } = await chrome.storage.sync.get(["spreadsheetId"]);

  if (!spreadsheetId) {
    console.warn("[Upskill BG] No spreadsheet ID configured. Queuing session.");
    await queueSession(session);
    return;
  }

  const token = await getAuthToken();
  if (!token) {
    console.warn("[Upskill BG] Auth failed. Queuing session.");
    await queueSession(session);
    return;
  }

  const success = await writeRowToSheet(token, spreadsheetId, session);
  if (!success) {
    await queueSession(session);
    scheduleRetry();
  }
}

// ─── Google Sheets write ──────────────────────────────────────────────────────

async function writeRowToSheet(token, spreadsheetId, session) {
  const sheetName = "activity_log";

  // Ensure header row exists on first write
  await ensureHeader(token, spreadsheetId, sheetName);

  const watchMinutes = (session.watchSeconds / 60).toFixed(1);
  const completionPct =
    session.videoDurationSeconds > 0
      ? Math.round((session.watchSeconds / session.videoDurationSeconds) * 100)
      : 0;

  const row = [
    session.timestamp,
    "youtube",
    "tutorial",
    session.title || "",
    session.channel || "",
    session.videoId || "",
    Number(watchMinutes),
    session.videoDurationSeconds || 0,
    completionPct,
    session.autoApproved ? "auto" : "manual",
    "",  // points — left blank, calculated by Sheets formula
  ];

  try {
    const res = await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [row] }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      console.error("[Upskill BG] Sheets write error:", err);
      return false;
    }

    console.log("[Upskill BG] Row written to Sheets ✓");
    return true;
  } catch (e) {
    console.error("[Upskill BG] Network error:", e);
    return false;
  }
}

async function ensureHeader(token, spreadsheetId, sheetName) {
  // Check if A1 already has content
  try {
    const res = await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.values && data.values.length > 0) return; // header exists

    // Write header
    const headers = [
      "timestamp",
      "source",
      "type",
      "title",
      "channel",
      "video_id",
      "watch_minutes",
      "video_duration_seconds",
      "completion_pct",
      "tag_method",
      "points",
    ];

    await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [headers] }),
      }
    );
  } catch (e) {
    console.warn("[Upskill BG] Could not ensure header:", e);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAuthToken(interactive = false) {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.error("[Upskill BG] Auth error:", chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

// Call this from popup when user clicks "Sign in"
async function getAuthTokenInteractive() {
  return getAuthToken(true);
}

// ─── Queue / retry ────────────────────────────────────────────────────────────

async function queueSession(session) {
  const { pendingQueue = [] } = await chrome.storage.local.get(["pendingQueue"]);
  pendingQueue.push(session);
  await chrome.storage.local.set({ pendingQueue });
  console.log(`[Upskill BG] Queued. Queue size: ${pendingQueue.length}`);
}

async function flushQueue() {
  const { pendingQueue = [] } = await chrome.storage.local.get(["pendingQueue"]);
  if (pendingQueue.length === 0) return;

  const { spreadsheetId } = await chrome.storage.sync.get(["spreadsheetId"]);
  if (!spreadsheetId) return;

  const token = await getAuthToken(false);
  if (!token) return;

  const remaining = [];
  for (const session of pendingQueue) {
    const success = await writeRowToSheet(token, spreadsheetId, session);
    if (!success) remaining.push(session);
  }

  await chrome.storage.local.set({ pendingQueue: remaining });
  if (remaining.length === 0) {
    console.log("[Upskill BG] Queue flushed ✓");
  }
}

function scheduleRetry() {
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) flushQueue();
});

// Flush queue on startup in case there were pending items from last session
chrome.runtime.onStartup.addListener(flushQueue);
chrome.runtime.onInstalled.addListener(flushQueue);

// ─── External messages from popup ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_AUTH_TOKEN") {
    getAuthToken(true).then((token) => sendResponse({ token }));
    return true;
  }
  if (msg.type === "FLUSH_QUEUE") {
    flushQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
});
