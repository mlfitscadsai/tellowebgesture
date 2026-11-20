# AeroHand — End-to-End DJI Tello Web Gesture Control

A complete web evolution of `tello-gesture-control` featuring:
- **Marketing & Onboarding Landing Page** explaining Tello Wi-Fi setup, all 8 trained hand gestures, and offline architecture.
- **Browser Flight Cockpit** using your own webcam + **100% offline-hosted MediaPipe HandLandmarker** + the exact original `keypoint_classifier.tflite` weights ported to pure TypeScript (**99.92% verified accuracy** on `keypoint.csv`).
- **Node.js + WebSocket + UDP Bridge (`server/`)** speaking native DJI Tello SDK v2/v3 (`192.168.10.1:8889` commands + `0.0.0.0:8890` 10 Hz telemetry + 10s keep-alive + disconnect hover watchdog).
- **Built-in Physics Simulator** so you can test webcam hand gestures, buffer sensitivity, and keyboard controls safely without powering on a drone.

## Why 100% Offline-First?

When your laptop connects to `TELLO-XXXXXX` Wi-Fi, you lose internet connectivity. All MediaPipe WASM binaries (`client/public/wasm/`), `hand_landmarker.task`, and `keypoint_classifier_weights.json` are served directly from `localhost:3001` with zero external CDN requests.

## Quick Start (Local)

### 1. Install & Build
```bash
cd tellowebgesture
npm run install:all
npm run build
```

### 2. Run Production Server (Recommended for Tello Wi-Fi)
```bash
npm start
```
Open **http://localhost:3001** in Chrome, Edge, Firefox, or Safari.

### 3. Development Mode (Hot Reload)
In two terminals:
```bash
npm run dev:server   # Backend UDP + WS bridge on :3001
npm run dev:client   # Vite dev server on :5173 (proxies /api & /ws)
```

## Flying with a Real DJI Tello
1. Power on your DJI Tello and join its Wi-Fi network (`TELLO-XXXXXX`).
2. Open `http://localhost:3001` and click **Connect Tello & Fly**.
3. Click **Test UDP Connection** in the diagnostics dialog to verify `command -> ok`, then click **Connect to Tello**.
4. Click **Start Webcam**, press **Space** (or **Takeoff**) to lift off, and control the drone with your hand gestures (`G`) or keyboard (`K`).
5. Press **Esc** or click **E-STOP** anytime for immediate hover/landing or motor cutoff.

## Keyboard Shortcuts
- `G` — Gesture control mode
- `K` — Keyboard control mode (`W/A/S/D` move, `R/F` up/down, `Q/E` rotate)
- `H` — Hover lock (`rc 0 0 0 0`)
- `Space` — Takeoff / Land
- `Esc` — Stop RC & Land

---

## Deploying to the Web (Vercel, Render, Railway, Fly.io)

> **Important Note on Real Tello Wi-Fi vs. Cloud Hosting**
> - **Cloud deployment (Vercel / Render / Railway)** is great for hosting the **Landing Page, Webcam Hand-Gesture Tracking, and Physics Simulator** publicly over HTTPS.
> - **Real DJI Tello hardware** (`192.168.10.1:8889`) uses local UDP over the drone's private `TELLO-XXXXXX` Wi-Fi network (which has no internet). A cloud server cannot reach `192.168.10.1` directly. To fly a physical Tello, either run `npm start` locally on the computer joined to Tello Wi-Fi, or point a hosted frontend to your local bridge (`ws://localhost:3001/ws`).
> - **HTTPS is required for Webcam access** on non-localhost domains; Vercel, Render, and Railway provide HTTPS automatically.

### Option 1: Single-Service Full-Stack Deploy on Render or Railway (Recommended)
Because the backend uses persistent **WebSockets** (`/ws`) and serves the built frontend + offline WASM/ML assets from one Express server, **Render** or **Railway** is the simplest zero-config option.

1. Push `tellowebgesture` to a GitHub repository.
2. Create a new **Web Service** on [Render](https://render.com) or [Railway](https://railway.app) pointing to the `tellowebgesture` directory.
3. Configure the service:
   - **Runtime**: Node 20+ (or Node 22/24)
   - **Build Command**:
     ```bash
     npm run install:all && npm run build
     ```
   - **Start Command**:
     ```bash
     npm start
     ```
   - **Environment Variables**: `PORT` is automatically set by Render/Railway (defaults to `3001`).
4. Deploy! Both the Landing Page, Cockpit, MediaPipe WASM/models, and WebSocket Simulator backend will run under one `https://your-app.onrender.com` URL.

### Option 2: Zero-Backend Static Deploy on Vercel (100% In-Browser ML + Simulator + Offline PWA)
Because the MediaPipe HandLandmarker, 8-class Keypoint Classifier, and Tello Physics Simulator all run **100% inside the user's browser** (with an offline-first Service Worker caching the models), you can deploy `client/` directly to **Vercel**, **Netlify**, or **Cloudflare Pages** with **no backend server at all**:

1. Import your repo into [Vercel](https://vercel.com) and set **Root Directory** to `client`.
2. Leave **Framework Preset** as `Vite` and **Build Command** as `npm run build` (the `prebuild` script automatically copies MediaPipe WASM into `public/wasm/`).
3. Click **Deploy**.
4. Open the HTTPS URL on **Desktop, iPhone Safari, Android Chrome, or iPad**:
   - Once loaded once, the Service Worker caches the app + ML models (`hand_landmarker.task` + `keypoint_classifier_weights.json` + WASM), so it keeps working even if you disconnect home Wi-Fi!
   - Optional: If you also deploy `server/` on Render/Railway (or run `npm start` locally for real Tello UDP flight), add `VITE_WS_URL` and `VITE_API_URL` in Vercel Project Settings.

### Option 3: Deploy with Vercel CLI (Quick Preview of Frontend)
```bash
cd tellowebgesture
npm run copy:wasm
cd client
npx vercel --prod
```
Set `VITE_WS_URL` and `VITE_API_URL` in the Vercel dashboard (or via `vercel env add`) so the Cockpit connects to your WebSocket backend.

### Option 4: Self-Host on a VPS / Docker
You can run the full stack on any Linux/macOS machine or VPS with Node.js 20+:
```bash
git clone <your-repo-url>
cd tellowebgesture
npm run install:all
npm run build
PORT=3001 npm start
```
Put **Nginx** or **Caddy** in front of port `3001` for automatic HTTPS (required for browser webcam access) and enable WebSocket upgrade headers (`Upgrade` and `Connection: upgrade`) for `/ws`.
