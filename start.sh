#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js not found. Install from https://nodejs.org"
    exit 1
fi

echo ""
echo " Cricket Auction — Starting..."
echo ""

# Start backend in background (needed for online mode)
cd "$SCRIPT_DIR/server"
node index.js &
SERVER_PID=$!

# Kill server on exit
trap 'kill "$SERVER_PID" 2>/dev/null; echo "Stopped."' INT TERM EXIT

sleep 1

# Open browser on landing page
(sleep 3 && (xdg-open "http://localhost:5173" 2>/dev/null || open "http://localhost:5173" 2>/dev/null)) &

echo " Backend running  : http://localhost:3001"
echo " Frontend starting: http://localhost:5173"
echo " Pick your mode on the landing page."
echo " Press Ctrl+C to stop everything."
echo ""

# Start frontend in foreground
cd "$SCRIPT_DIR/client"
npm run dev

