/**
 * popup.js
 * Drives the extension settings popup.
 */

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `show ${type}`;
  setTimeout(() => { el.className = ""; }, 2800);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuthStatus() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      resolve(!!token && !chrome.runtime.lastError);
    });
  });
}

async function refreshAuthUI() {
  const dot   = document.getElementById("auth-dot");
  const label = document.getElementById("auth-label");
  const btn   = document.getElementById("auth-btn");

  const authed = await checkAuthStatus();
  if (authed) {
    dot.className   = "dot connected";
    label.textContent = "Signed in to Google";
    btn.textContent   = "Sign out";
    btn.className     = "btn btn-danger";
  } else {
    dot.className   = "dot";
    label.textContent = "Not signed in";
    btn.textContent   = "Sign in with Google";
    btn.className     = "btn btn-primary";
  }
}

document.getElementById("auth-btn").addEventListener("click", async () => {
  const authed = await checkAuthStatus();

  if (authed) {
    // Sign out: revoke cached token
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
          refreshAuthUI();
          showToast("Signed out");
        });
      }
    });
  } else {
    chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" }, (res) => {
      if (res?.token) {
        showToast("Signed in ✓", "success");
        refreshAuthUI();
      } else {
        showToast("Sign-in failed", "error");
      }
    });
  }
});

// ─── Spreadsheet ID ───────────────────────────────────────────────────────────

async function loadSpreadsheetId() {
  const { spreadsheetId } = await chrome.storage.sync.get(["spreadsheetId"]);
  if (spreadsheetId) {
    document.getElementById("sheet-id").value = spreadsheetId;
  }
}

document.getElementById("save-sheet-btn").addEventListener("click", async () => {
  const val = document.getElementById("sheet-id").value.trim();
  if (!val) { showToast("Please paste a Spreadsheet ID", "error"); return; }

  // Accept full URL or just the ID
  const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = match ? match[1] : val;

  await chrome.storage.sync.set({ spreadsheetId: id });
  document.getElementById("sheet-id").value = id;
  showToast("Spreadsheet saved ✓", "success");
});

// ─── Channel whitelist ────────────────────────────────────────────────────────

async function loadChannels() {
  const { whitelistedChannels = [] } = await chrome.storage.sync.get(["whitelistedChannels"]);
  renderChannels(whitelistedChannels);
}

function renderChannels(channels) {
  const list  = document.getElementById("channel-list");
  const empty = document.getElementById("channel-empty");

  // Remove all channel items (keep empty placeholder)
  list.querySelectorAll(".channel-item").forEach((el) => el.remove());

  if (channels.length === 0) {
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  channels.forEach((name) => {
    const li = document.createElement("li");
    li.className = "channel-item";
    li.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button class="channel-remove" data-name="${escapeHtml(name)}" title="Remove">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".channel-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeChannel(btn.dataset.name));
  });
}

async function addChannel() {
  const input = document.getElementById("channel-input");
  const name  = input.value.trim();
  if (!name) return;

  const { whitelistedChannels = [] } = await chrome.storage.sync.get(["whitelistedChannels"]);
  if (whitelistedChannels.some((c) => c.toLowerCase() === name.toLowerCase())) {
    showToast("Channel already in list");
    return;
  }

  whitelistedChannels.push(name);
  await chrome.storage.sync.set({ whitelistedChannels });
  input.value = "";
  renderChannels(whitelistedChannels);
  showToast(`Added: ${name}`, "success");
}

async function removeChannel(name) {
  const { whitelistedChannels = [] } = await chrome.storage.sync.get(["whitelistedChannels"]);
  const updated = whitelistedChannels.filter((c) => c !== name);
  await chrome.storage.sync.set({ whitelistedChannels: updated });
  renderChannels(updated);
  showToast(`Removed: ${name}`);
}

document.getElementById("add-channel-btn").addEventListener("click", addChannel);
document.getElementById("channel-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addChannel();
});

// ─── Stats ────────────────────────────────────────────────────────────────────

async function loadStats() {
  const { sessionCount = 0, totalMinutes = 0 } = await chrome.storage.local.get([
    "sessionCount",
    "totalMinutes",
  ]);
  document.getElementById("stat-sessions").textContent = sessionCount || "0";
  document.getElementById("stat-minutes").textContent =
    totalMinutes > 0 ? Math.round(totalMinutes) : "0";
}

// ─── Queue ────────────────────────────────────────────────────────────────────

async function loadQueue() {
  const { pendingQueue = [] } = await chrome.storage.local.get(["pendingQueue"]);
  const badge = document.getElementById("queue-badge");
  badge.textContent = `${pendingQueue.length} item${pendingQueue.length !== 1 ? "s" : ""}`;
  badge.className = `queue-badge${pendingQueue.length > 0 ? " has-items" : ""}`;
}

document.getElementById("flush-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "FLUSH_QUEUE" }, () => {
    showToast("Retrying…");
    setTimeout(loadQueue, 3000);
  });
});

// ─── Utils ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all([
    refreshAuthUI(),
    loadSpreadsheetId(),
    loadChannels(),
    loadStats(),
    loadQueue(),
  ]);
})();
