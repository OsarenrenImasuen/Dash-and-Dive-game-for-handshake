# Dive and Dash Online

This version supports a room host and up to two additional players on separate computers. The Node.js server is authoritative: it updates player positions, validates collisions, awards boosts, and decides the winner. Browsers only send left/right input and render the state sent by the server.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` in one browser. For another device on the same Wi-Fi, use `http://YOUR-COMPUTER-IP:3000`.

## Deploy to Railway

1. Create a new GitHub repository and upload this entire folder.
2. In Railway, choose **New Project** → **Deploy from GitHub repo** and select the repository.
3. Railway detects `package.json` and runs `npm start`. The included `railway.json` supplies deployment settings.
4. Open Railway's public domain after deployment and share the same URL with players.
5. One player selects **Create Room**, shares the five-letter code, and the host begins the race after everyone joins.

No database or environment variables are required. Rooms live in server memory and disappear when the Railway service restarts.
