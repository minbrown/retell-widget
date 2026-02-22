# Retell AI Voice Widget

A browser-based voice call widget that:
1. Collects visitor contact info (name, phone, email)
2. Creates a **GoHighLevel contact** server-side
3. Starts a **live Retell AI voice call** in the browser

No phone call required. No API keys exposed to the browser.

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A **Retell AI account** — [retellai.com](https://retellai.com)
- A **GoHighLevel account** — [gohighlevel.com](https://gohighlevel.com)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your real keys:

| Variable            | Where to find it |
|---------------------|------------------|
| `RETELL_API_KEY`    | Retell dashboard → API Keys |
| `RETELL_AGENT_ID`   | Retell dashboard → Agents → select agent |
| `GHL_API_KEY`       | GHL → Settings → API Keys (Private Integration token) |
| `GHL_LOCATION_ID`   | GHL → Settings → Business Info → Location ID |
| `PORT`              | Default: `3000` |

> ⚠️ **Never commit `.env` to version control.** It's git-ignored by default.

### 3. Start the server

```bash
npm start
```

Or use watch mode during development:

```bash
npm run dev
```

### 4. Open in browser

```
http://localhost:3000
```

---

## How it works

```
User fills form
      │
      ▼
POST /create-web-call  (backend)
      ├─► Creates GoHighLevel contact  (GHL_API_KEY — server-side only)
      └─► Creates Retell web call      (RETELL_API_KEY — server-side only)
             │
             ▼
         Returns { access_token }
             │
             ▼
   retellWebClient.startCall({ accessToken })   ← must happen within 30s!
             │
             ▼
    Live voice call begins in browser
```

> ⚠️ **30-second token expiry**: The Retell `access_token` is valid for only **30 seconds** after it's issued. The frontend calls `startCall()` immediately after receiving it — do not add delays between the API response and `startCall()`.

---

## Embedding on another site

### Option A — iframe

```html
<iframe 
  src="https://your-server.com" 
  width="460" 
  height="580" 
  frameborder="0"
  allow="microphone"
></iframe>
```

> The `allow="microphone"` attribute is required for the browser to grant mic access inside an iframe.

### Option B — Host the `/public/index.html` directly

Copy the contents of `public/index.html` into any page. Update the `fetch("/create-web-call", ...)` URL to point to your deployed backend.

---

## Project structure

```
retell-widget/
├── server.js          ← Express backend
├── public/
│   └── index.html     ← Frontend widget
├── .env               ← Your secrets (git-ignored)
├── .env.example       ← Template — commit this
├── package.json
└── README.md
```
