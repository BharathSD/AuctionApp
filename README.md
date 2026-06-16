# 🏏 Cricket Auction App

A real-time cricket player auction web app for managing live player auctions in your cricket league. Supports both **Offline** (single-screen auctioneer) and **Online** (captains bid from their own devices) modes.

---

## Features

- **Offline Mode** — Auctioneer controls everything from one screen; no network needed
- **Online Mode** — Captains join from their phones/laptops and bid in real-time via WebSockets
- **Live timer** — Countdown per bid with auto-sell/unsold on expiry
- **Pause / Resume** — Admin can pause and resume the auction at any time
- **Randomize order** — Optionally shuffle player auction order at start
- **Max players per team** — Configurable roster cap; full teams are blocked from bidding
- **Pre-allocate / Retain players** — Assign players to teams before the auction starts
- **Auto-finish** — Auction ends automatically when all team rosters are full
- **Captain connection guard** — Start button locked until all captains are connected; mid-auction disconnects shown as alerts to admin
- **Single-connection enforcement** — One active socket per captain; duplicate joins are rejected with a 10-second grace period for reconnects
- **Undo last bid** — Admin can revert the most recent bid
- **Re-auction unsold players** — Queue unsold players for a second round
- **Auction recovery** — Auto-saves live state to localStorage; manual snapshot download (`.json`); restore from snapshot file
- **Viewer display** — Read-only fullscreen page (`/watch/:roomCode`) for streaming; hides exact budgets
- **Results export** — Download final rosters as `.xlsx` (ExcelJS)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS v4 |
| Backend | Node.js + Express 5 + Socket.io |
| Routing | React Router DOM |
| Export | ExcelJS |
| Deployment | Render.com |

---

## Getting Started (Local)

### Prerequisites

- Node.js v18+ (or use the bundled `node-v24.16.0-win-x64/` on Windows)

### Install dependencies

```bash
npm run install:all
```

### Run in development

**Windows:**
```bat
.\start.bat
```

**Mac/Linux:**
```bash
./start.sh
```

Or run individually:
```bash
# Terminal 1 — backend (port 3001)
npm run dev:server

# Terminal 2 — frontend (port 5173)
npm run dev:client
```

The frontend dev server proxies API and socket requests to `localhost:3001`.

---

## Deployment (Render)

The app is configured for a single Render web service via `render.yaml`.

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Start command | `npm start` |
| Environment | `NODE_ENV=production` |

On build, the React app is compiled into `client/dist/` and served statically by Express in production.

Push to `master` to trigger an auto-deploy.

---

## Player CSV Format

Upload a CSV file in the Players setup step. Supported column names:

| Column | Aliases |
|---|---|
| `name` | `Name` |
| `role` | `Role` |
| `basePrice` | `base_price`, `Base Price` |

**Example:**
```csv
name,role,basePrice
Virat Kohli,Batsman,200
Jasprit Bumrah,Bowler,200
Hardik Pandya,All-rounder,150
Rishabh Pant,Wicket-keeper,100
```

A sample file is included at `sample-players.csv`.

---

## Auction Modes

### Offline
- Single auctioneer screen — no captains needed
- Full state persisted to `localStorage`; refresh-safe
- Resume in-progress auction automatically on page load

### Online
- Auctioneer sets up room → shares join link with captains
- Captains enter team PIN to join
- Admin controls player queue; captains tap **Bid** to place bids
- Viewer page (`/watch/:roomCode`) for screen-sharing/streaming

---

## Recovery

- **Auto-save** — Live state saved to `localStorage` on every change
- **Manual snapshot** — Click `💾 Save` in the admin panel to download a `.json` file
- **Restore** — On the landing page, click `💾 Resume saved auction from snapshot file →` and upload the `.json`

---

## Project Structure

```
AuctionApp/
├── client/               # React + Vite frontend
│   └── src/
│       ├── pages/        # Landing, Setup, AdminOnline, OfflineAuction,
│       │                 # CaptainBidding, ViewerDisplay, Results
│       └── hooks/        # useOnlineAuction, useOfflineAuction, useAuctionStorage
├── server/
│   ├── index.js          # Express + Socket.io server
│   └── auction-engine.js # In-memory auction state machine
├── render.yaml           # Render deployment config
├── package.json          # Root scripts (build, start, dev)
└── sample-players.csv    # Example player list
```
