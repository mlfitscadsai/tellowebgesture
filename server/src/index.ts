import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { TelloUdpController, probeTelloWifi } from './telloUdp.js';
import { TelloSimulatorController } from './telloSim.js';
import type { ClientMessage, DroneController, ServerMessage } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);

const app = express();
app.use(cors());
app.use(express.json());

let controller: DroneController = new TelloSimulatorController();

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: ServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function attachControllerCallbacks(ctrl: DroneController): void {
  ctrl.onTelemetry((data) => {
    broadcast({ type: 'telemetry', data });
  });
  ctrl.onLog((level, text) => {
    broadcast({ type: 'log', level, text, timestamp: Date.now() });
  });
}

attachControllerCallbacks(controller);

// REST endpoints
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: controller.mode,
    connected: controller.connected,
    inFlight: controller.inFlight,
    host: controller.host,
    port: controller.port,
  });
});

app.post('/api/test-connection', async (req, res) => {
  const host = typeof req.body?.host === 'string' && req.body.host.trim() ? req.body.host.trim() : '192.168.10.1';
  const port = typeof req.body?.port === 'number' ? req.body.port : 8889;
  const result = await probeTelloWifi(host, port);
  res.json(result);
});

// Serve built frontend in production (100% offline-ready when on Tello Wi-Fi)
const clientDistDir = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

wss.on('connection', (ws) => {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  // Send current state immediately on connect
  send({
    type: 'status',
    connected: controller.connected,
    mode: controller.mode,
    inFlight: controller.inFlight,
    host: controller.host,
    port: controller.port,
  });
  send({ type: 'telemetry', data: controller.getTelemetry() });

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
    } catch {
      send({ type: 'log', level: 'error', text: 'Invalid JSON payload', timestamp: Date.now() });
      return;
    }

    if (msg.type === 'ping') {
      send({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
      return;
    }

    if (msg.type === 'connect') {
      await controller.disconnect();
      controller = msg.mode === 'tello' ? new TelloUdpController() : new TelloSimulatorController();
      attachControllerCallbacks(controller);

      const res = await controller.connect(msg.host, msg.port);
      broadcast({
        type: 'status',
        connected: controller.connected,
        mode: controller.mode,
        inFlight: controller.inFlight,
        host: controller.host,
        port: controller.port,
        message: res.message,
      });
      broadcast({ type: 'telemetry', data: controller.getTelemetry() });
      return;
    }

    if (msg.type === 'disconnect') {
      await controller.disconnect();
      broadcast({
        type: 'status',
        connected: false,
        mode: controller.mode,
        inFlight: false,
        host: controller.host,
        port: controller.port,
        message: 'Disconnected',
      });
      broadcast({ type: 'telemetry', data: controller.getTelemetry() });
      return;
    }

    if (msg.type === 'rc') {
      controller.sendRc({ lr: msg.lr, fb: msg.fb, ud: msg.ud, yaw: msg.yaw });
      return;
    }

    if (msg.type === 'command') {
      const res = await controller.sendCommand(msg.command);
      broadcast({
        type: 'command_result',
        command: msg.command,
        ok: res.ok,
        response: res.response,
      });
      broadcast({
        type: 'status',
        connected: controller.connected,
        mode: controller.mode,
        inFlight: controller.inFlight,
        host: controller.host,
        port: controller.port,
      });
    }
  });

  ws.on('close', () => {
    // Safety watchdog: if last browser client disconnects while flying, stop RC drift immediately
    if (wss.clients.size === 0 && controller.connected) {
      controller.sendRc({ lr: 0, fb: 0, ud: 0, yaw: 0 });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚁 Tello Gesture Web Bridge running on http://localhost:${PORT}`);
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`   Tello UDP target:   192.168.10.1:8889 (Telemetry on UDP 8890)\n`);
});

process.on('SIGINT', async () => {
  await controller.disconnect();
  process.exit(0);
});
