import dgram from 'node:dgram';
import type { DroneController, DroneMode, RcVector, TelemetryData } from './types.js';

const DEFAULT_TELLO_HOST = '192.168.10.1';
const DEFAULT_TELLO_PORT = 8889;
const STATE_PORT = 8890;

const ALLOWED_COMMANDS = new Set([
  'command',
  'takeoff',
  'land',
  'emergency',
  'stop',
  'battery?',
  'sdk?',
  'sn?',
  'speed?',
  'time?',
  'temp?',
  'height?',
  'flip f',
  'flip b',
  'flip l',
  'flip r',
]);

function clampRc(v: number): number {
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export class TelloUdpController implements DroneController {
  public readonly mode: DroneMode = 'tello';
  public host = DEFAULT_TELLO_HOST;
  public port = DEFAULT_TELLO_PORT;
  public connected = false;
  public inFlight = false;

  private cmdSocket: dgram.Socket | null = null;
  private stateSocket: dgram.Socket | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastRcSentAt = 0;

  private pendingResolve: ((resp: string) => void) | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;
  private commandQueue: Array<{
    cmd: string;
    timeoutMs: number;
    resolve: (res: { ok: boolean; response: string }) => void;
  }> = [];
  private processingQueue = false;

  private telemetryCb: ((data: TelemetryData) => void) | null = null;
  private logCb: ((level: 'info' | 'warn' | 'error' | 'cmd', text: string) => void) | null = null;

  private telemetry: TelemetryData = {
    battery: 0,
    height: 0,
    tof: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    vgx: 0,
    vgy: 0,
    vgz: 0,
    tempLow: 0,
    tempHigh: 0,
    baro: 0,
    flightTime: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    inFlight: false,
    mode: 'tello',
    connected: false,
    lastUpdated: Date.now(),
  };

  public onTelemetry(cb: (data: TelemetryData) => void): void {
    this.telemetryCb = cb;
  }

  public onLog(cb: (level: 'info' | 'warn' | 'error' | 'cmd', text: string) => void): void {
    this.logCb = cb;
  }

  private log(level: 'info' | 'warn' | 'error' | 'cmd', text: string): void {
    this.logCb?.(level, text);
  }

  public getTelemetry(): TelemetryData {
    return { ...this.telemetry, inFlight: this.inFlight, connected: this.connected };
  }

  public async connect(host = DEFAULT_TELLO_HOST, port = DEFAULT_TELLO_PORT): Promise<{ ok: boolean; message: string }> {
    await this.disconnect();

    this.host = host;
    this.port = port;

    this.cmdSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.cmdSocket.on('message', (msg) => {
      const response = msg.toString('utf8').trim();
      if (this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        if (this.pendingTimer) {
          clearTimeout(this.pendingTimer);
          this.pendingTimer = null;
        }
        resolve(response);
      }
    });

    this.cmdSocket.on('error', (err) => {
      this.log('error', `UDP command socket error: ${err.message}`);
    });

    await new Promise<void>((resolve, reject) => {
      this.cmdSocket!.once('error', reject);
      this.cmdSocket!.bind(0, () => {
        this.cmdSocket?.off('error', reject);
        resolve();
      });
    });

    // Start state listener on UDP 8890
    this.startStateListener();

    this.log('info', `Connecting to DJI Tello at ${this.host}:${this.port}...`);
    const res = await this.sendRawCommand('command', 3500);
    if (!res.ok) {
      await this.disconnect();
      return {
        ok: false,
        message: `Tello did not respond on ${this.host}:${this.port}. Make sure your computer is connected to the TELLO-XXXXXX Wi-Fi network.`,
      };
    }

    this.connected = true;
    this.telemetry.connected = true;
    this.log('info', 'Tello SDK mode active (ok). Listening for telemetry on UDP 8890.');

    // Query initial battery in background
    void this.sendCommand('battery?').then((batRes) => {
      const parsed = Number.parseInt(batRes.response, 10);
      if (!Number.isNaN(parsed)) {
        this.telemetry.battery = parsed;
        this.telemetry.lastUpdated = Date.now();
        this.telemetryCb?.(this.getTelemetry());
      }
    });

    // Keep-alive every 10s so Tello doesn't auto-land after 15s inactivity
    this.keepAliveTimer = setInterval(() => {
      if (!this.connected) return;
      void this.sendRawCommand('battery?', 2000).then((batRes) => {
        const parsed = Number.parseInt(batRes.response, 10);
        if (!Number.isNaN(parsed)) {
          this.telemetry.battery = parsed;
          this.telemetry.lastUpdated = Date.now();
          this.telemetryCb?.(this.getTelemetry());
        }
      });
    }, 10000);

    return { ok: true, message: `Connected to DJI Tello (${this.host}:${this.port})` };
  }

  private startStateListener(): void {
    try {
      this.stateSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.stateSocket.on('message', (msg) => {
        const raw = msg.toString('utf8').trim();
        this.parseStateString(raw);
      });
      this.stateSocket.on('error', (err) => {
        this.log('warn', `Telemetry UDP 8890 warning: ${err.message}`);
      });
      this.stateSocket.bind(STATE_PORT);
    } catch (err) {
      this.log('warn', `Could not bind telemetry port ${STATE_PORT}: ${String(err)}`);
    }
  }

  private parseStateString(raw: string): void {
    // Example: pitch:0;roll:0;yaw:0;vgx:0;vgy:0;vgz:0;templ:42;temph:45;tof:10;h:0;bat:92;baro:12.3;time:0;
    const fields = raw.split(';');
    const map: Record<string, number> = {};
    for (const part of fields) {
      const [k, v] = part.split(':');
      if (k && v !== undefined) {
        const num = Number.parseFloat(v);
        if (!Number.isNaN(num)) {
          map[k.trim()] = num;
        }
      }
    }

    this.telemetry = {
      ...this.telemetry,
      pitch: map.pitch ?? this.telemetry.pitch,
      roll: map.roll ?? this.telemetry.roll,
      yaw: map.yaw ?? this.telemetry.yaw,
      vgx: map.vgx ?? this.telemetry.vgx,
      vgy: map.vgy ?? this.telemetry.vgy,
      vgz: map.vgz ?? this.telemetry.vgz,
      tempLow: map.templ ?? this.telemetry.tempLow,
      tempHigh: map.temph ?? this.telemetry.tempHigh,
      tof: map.tof ?? this.telemetry.tof,
      height: map.h ?? this.telemetry.height,
      battery: map.bat ?? this.telemetry.battery,
      baro: map.baro ?? this.telemetry.baro,
      flightTime: map.time ?? this.telemetry.flightTime,
      posZ: map.h ?? this.telemetry.posZ,
      inFlight: this.inFlight,
      connected: this.connected,
      lastUpdated: Date.now(),
    };

    this.telemetryCb?.(this.getTelemetry());
  }

  public async disconnect(): Promise<void> {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.connected && this.cmdSocket) {
      // Zero RC before disconnecting
      this.sendRc({ lr: 0, fb: 0, ud: 0, yaw: 0 });
    }
    this.connected = false;
    this.inFlight = false;
    this.telemetry.connected = false;
    this.telemetry.inFlight = false;
    this.commandQueue = [];
    this.pendingResolve = null;

    if (this.cmdSocket) {
      try {
        this.cmdSocket.close();
      } catch {
        // ignore
      }
      this.cmdSocket = null;
    }
    if (this.stateSocket) {
      try {
        this.stateSocket.close();
      } catch {
        // ignore
      }
      this.stateSocket = null;
    }
  }

  public sendRc(rc: RcVector): void {
    if (!this.connected || !this.cmdSocket) return;
    const now = Date.now();
    // Always allow immediate zero-stop, otherwise cap at 20 Hz
    const isZero = rc.lr === 0 && rc.fb === 0 && rc.ud === 0 && rc.yaw === 0;
    if (!isZero && now - this.lastRcSentAt < 50) return;
    this.lastRcSentAt = now;

    const cmd = `rc ${clampRc(rc.lr)} ${clampRc(rc.fb)} ${clampRc(rc.ud)} ${clampRc(rc.yaw)}`;
    const payload = Buffer.from(cmd, 'utf8');
    this.cmdSocket.send(payload, 0, payload.length, this.port, this.host);
  }

  public async sendCommand(command: string): Promise<{ ok: boolean; response: string }> {
    const clean = command.trim().toLowerCase();
    if (!ALLOWED_COMMANDS.has(clean) && !/^(up|down|left|right|forward|back|cw|ccw)\s+\d{1,3}$/.test(clean)) {
      return { ok: false, response: `Unsupported command: ${clean}` };
    }

    if (!this.connected || !this.cmdSocket) {
      return { ok: false, response: 'Not connected to Tello' };
    }

    // Emergency bypasses the command queue immediately!
    if (clean === 'emergency') {
      this.log('warn', 'EMERGENCY STOP sent immediately!');
      this.inFlight = false;
      const payload = Buffer.from('emergency', 'utf8');
      this.cmdSocket.send(payload, 0, payload.length, this.port, this.host);
      return { ok: true, response: 'ok' };
    }

    const timeoutMs = clean === 'takeoff' || clean === 'land' || clean.startsWith('flip') ? 10000 : 4000;

    return new Promise((resolve) => {
      this.commandQueue.push({ cmd: clean, timeoutMs, resolve });
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.commandQueue.length > 0) {
      const next = this.commandQueue.shift()!;
      const res = await this.sendRawCommand(next.cmd, next.timeoutMs);
      if (res.ok) {
        if (next.cmd === 'takeoff') this.inFlight = true;
        if (next.cmd === 'land') this.inFlight = false;
      }
      next.resolve(res);
    }

    this.processingQueue = false;
  }

  private sendRawCommand(cmd: string, timeoutMs: number): Promise<{ ok: boolean; response: string }> {
    return new Promise((resolve) => {
      if (!this.cmdSocket) {
        resolve({ ok: false, response: 'UDP socket closed' });
        return;
      }

      if (cmd !== 'battery?') {
        this.log('cmd', `UDP -> ${cmd}`);
      }

      this.pendingResolve = (response) => {
        const ok = response.toLowerCase() === 'ok' || (cmd.endsWith('?') && response.length > 0 && !response.toLowerCase().includes('error'));
        if (cmd !== 'battery?') {
          this.log(ok ? 'info' : 'warn', `Tello <- ${response}`);
        }
        resolve({ ok, response });
      };

      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingTimer = null;
        if (cmd !== 'battery?') {
          this.log('warn', `Timeout waiting for "${cmd}" (${timeoutMs}ms)`);
        }
        resolve({ ok: false, response: 'timeout' });
      }, timeoutMs);

      const payload = Buffer.from(cmd, 'utf8');
      this.cmdSocket.send(payload, 0, payload.length, this.port, this.host, (err) => {
        if (err && this.pendingResolve) {
          const r = this.pendingResolve;
          this.pendingResolve = null;
          if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
          }
          r(`error: ${err.message}`);
        }
      });
    });
  }
}

export async function probeTelloWifi(host = DEFAULT_TELLO_HOST, port = DEFAULT_TELLO_PORT): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  const sock = dgram.createSocket('udp4');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        message: `No UDP response from ${host}:${port}. Connect your Wi-Fi to TELLO-XXXXXX and ensure the drone is powered on.`,
      });
    }, 2500);

    sock.once('message', (msg) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      const text = msg.toString('utf8').trim();
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve({
        ok: text.toLowerCase() === 'ok',
        latencyMs,
        message: `Tello responded "${text}" in ${latencyMs}ms`,
      });
    });

    sock.once('error', (err) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        message: `Network error: ${err.message}`,
      });
    });

    const payload = Buffer.from('command', 'utf8');
    sock.send(payload, 0, payload.length, port, host);
  });
}
