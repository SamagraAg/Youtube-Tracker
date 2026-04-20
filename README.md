# Upskill Tracker — YouTube Extension

Chrome extension that tracks time spent watching learning content on YouTube and logs sessions to Google Sheets automatically.

---

## Setup (one-time, ~15 minutes)

### Step 1: Create a Google Cloud project & OAuth credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Upskill Tracker")
3. Go to **APIs & Services → Enable APIs** → enable **Google Sheets API**
4. Go to **APIs & Services → OAuth consent screen**
   - Choose **External**
   - Fill in app name ("Upskill Tracker"), your email
   - Add scope: `https://www.googleapis.com/auth/spreadsheets`
   - Add your own Google account as a **Test user**
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Chrome extension**
   - For "Application ID" paste your extension ID (see Step 3 to get this)
   - Copy the **Client ID** (looks like `XXXX.apps.googleusercontent.com`)

### Step 2: Update manifest.json

Open `manifest.json` and replace:
```
"client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```
with your actual Client ID from Step 1.

### Step 3: Load the extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `yt-upskill-tracker` folder
4. Note your **Extension ID** shown on the card — you need this for Step 1 above

### Step 4: Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Rename the first sheet tab to exactly: `activity_log`
3. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**COPY_THIS_PART**/edit`

### Step 5: Configure the extension

1. Click the extension icon in Chrome toolbar
2. Click **Sign in with Google** → authorise the app
3. Paste your **Spreadsheet ID** → click Save
4. Add trusted channels (e.g. Fireship, NeetCode, Traversy Media, Gaurav Sen)

---

## How it works

| Scenario | What happens |
|---|---|
| You open a video from a **whitelisted channel** | Tracking starts automatically. Green "Tracking 0:00" badge appears bottom-right of YouTube. |
| You open **any other video** | A "Track as learning?" prompt appears for 15 seconds. Click **Yes, track** to start. |
| You **pause**, switch tabs, or go idle | Timer pauses. Resumes when you come back. |
| Video ends or you navigate away | Session is flushed to Google Sheets. |
| Sheets API is down or you're offline | Session is queued locally. Retried automatically every 5 minutes. |

---

## Google Sheets columns (activity_log tab)

| Column | Description |
|---|---|
| timestamp | ISO 8601 datetime of session end |
| source | Always "youtube" |
| type | Always "tutorial" |
| title | Video title |
| channel | Channel name |
| video_id | YouTube video ID |
| watch_minutes | Active watch time (decimal minutes) |
| video_duration_seconds | Total video length |
| completion_pct | % of video watched |
| tag_method | "auto" (whitelist) or "manual" (button) |
| points | Leave blank — fill with your scoring formula |

### Suggested points formula for column K (paste in K2, drag down):
```
=IF(J2="auto", ROUND(H2/60 * 8, 1), ROUND(H2/60 * 6, 1))
```
This gives 8 pts/hr for auto-approved (trusted channel) and 6 pts/hr for manually tagged videos.

---

## File structure

```
yt-upskill-tracker/
├── manifest.json      — Extension config, permissions, OAuth
├── content.js         — Injected into YouTube: detects videos, tracks time, shows UI
├── background.js      — Service worker: Sheets API calls, queue, auth
├── popup.html         — Settings popup UI
├── popup.js           — Settings popup logic
└── icons/             — Place icon16.png, icon48.png, icon128.png here
```

---

## Icons

You need three icon files in the `icons/` folder:
- `icon16.png` (16×16)
- `icon48.png` (48×48)  
- `icon128.png` (128×128)

Any PNG will work — even a plain coloured square — to get the extension loading.

---

## Troubleshooting

**"Sign in failed"** — Make sure your Google account is added as a Test User in the OAuth consent screen, and that the Extension ID in Google Cloud matches your loaded extension.

**Rows not appearing in Sheets** — Check the extension ID in `chrome://extensions` matches what's registered in Google Cloud. Open DevTools on the background service worker (chrome://extensions → "service worker" link) and look for console errors.

**Timer not starting** — YouTube sometimes delays the `yt-navigate-finish` event. Refresh the page. If it still doesn't work, check the console on the YouTube tab for `[Upskill]` log lines.

**Wrong channel name detected** — YouTube's DOM varies. The extension tries 3 different selectors. If your channel isn't matching, open DevTools on a YouTube video and run:
```js
document.querySelector("ytd-channel-name yt-formatted-string a")?.textContent
```
# Youtube-Tracker
