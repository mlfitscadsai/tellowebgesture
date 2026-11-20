import type { LogEntry, RcVector, TelemetryData } from '../types/tello';

const INITIAL_SIM_TELEMETRY: TelemetryData = {
  battery: 95,
  height: 0,
  tof: 10,
  pitch: 0,
  roll: 0,
  yaw: 0,
  vgx: 0,
  vgy: 0,
  vgz: 0,
  tempLow: 38,
  tempHigh: 41,
  baro: 0,
  flightTime: 0,
  posX: 0,
  posY: 0,
  posZ: 0,
  inFlight: false,
  mode: 'simulator',
  connected: false,
  lastUpdated: Date.now(),
};

/**
 * Pure in-browser DJI Tello physics simulator.
 * Runs 100% locally in the user's browser (desktop, iPhone, Android, iPad)
 * with zero backend server and zero internet connection required.
 */
export class BrowserTelloSimulator {
  private connected = false;
  private inFlight = false;
  private tickTimer: number | null = null;
  private flightStartMs = 0;
  private rc: RcVector = { lr: 0, fb: 0, ud: 0, yaw: 0 };
  private telemetry: TelemetryData = { ...INITIAL_SIM_TELEMETRY };

  private onTelemetry: (data: TelemetryData) => void;
  private onLog: (level: LogEntry['level'], text: string) => void;
  private onStatus: (connected: boolean, inFlight: boolean, message: string) => void;

  constructor(callbacks: {
    onTelemetry: (data: TelemetryData) => void;
    onLog: (level: LogEntry['level'], text: string) => void;
    onStatus: (connected: boolean, inFlight: boolean, message: string) => void;
  }) {
    this.onTelemetry = callbacks.onTelemetry;
    this.onLog = callbacks.onLog;
    this.onStatus = callbacks.onStatus;
  }

  public connect(): void {
    this.disconnect(true);
    this.connected = true;
    this.inFlight = false;
    this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
    this.telemetry = {
      ...INITIAL_SIM_TELEMETRY,
      connected: true,
      lastUpdated: Date.now(),
    };

    this.onStatus(true, false, 'In-Browser Simulator active (100% on-device)');
    this.onLog('info', 'In-Browser Tello Simulator connected — running 100% locally in your browser.');
    this.emitTelemetry();

    this.tickTimer = window.setInterval(() => this.stepPhysics(0.1), 100);
  }

  public disconnect(silent = false): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.connected = false;
    this.inFlight = false;
    this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
    this.telemetry.connected = false;
    this.telemetry.inFlight = false;

    if (!silent) {
      this.onStatus(false, false, 'Simulator disconnected');
      this.emitTelemetry();
    }
  }

  public sendRc(rc: RcVector): void {
    if (!this.connected) return;
    this.rc = {
      lr: Math.max(-100, Math.min(100, Math.round(rc.lr))),
      fb: Math.max(-100, Math.min(100, Math.round(rc.fb))),
      ud: Math.max(-100, Math.min(100, Math.round(rc.ud))),
      yaw: Math.max(-100, Math.min(100, Math.round(rc.yaw))),
    };
  }

  public sendCommand(command: string): void {
    if (!this.connected) return;
    const clean = command.trim().toLowerCase();
    this.onLog('cmd', `SIM -> ${clean}`);

    if (clean === 'takeoff') {
      if (this.inFlight) return;
      this.inFlight = true;
      this.flightStartMs = Date.now();
      this.telemetry.posZ = 95;
      this.telemetry.height = 95;
      this.telemetry.tof = 95;
      this.onLog('info', 'SIM <- ok (Takeoff complete, hovering at 95 cm)');
      this.onStatus(true, true, 'In-Browser Simulator • In Flight');
      this.emitTelemetry();
      return;
    }

    if (clean === 'land') {
      this.inFlight = false;
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.telemetry.posZ = 0;
      this.telemetry.height = 0;
      this.telemetry.tof = 10;
      this.telemetry.pitch = 0;
      this.telemetry.roll = 0;
      this.onLog('info', 'SIM <- ok (Landed safely)');
      this.onStatus(true, false, 'In-Browser Simulator • Landed');
      this.emitTelemetry();
      return;
    }

    if (clean === 'emergency') {
      this.inFlight = false;
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.telemetry.posZ = 0;
      this.telemetry.height = 0;
      this.telemetry.tof = 10;
      this.onLog('warn', 'SIM <- ok (EMERGENCY motor cutoff)');
      this.onStatus(true, false, 'In-Browser Simulator • Emergency Stop');
      this.emitTelemetry();
      return;
    }

    if (clean === 'stop') {
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.onLog('info', 'SIM <- ok (Hover stop)');
      return;
    }

    if (clean.startsWith('flip ')) {
      if (!this.inFlight) {
        this.onLog('warn', 'SIM <- error: take off first to flip');
        return;
      }
      const dir = clean.split(' ')[1];
      this.telemetry.pitch = dir === 'f' ? 28 : dir === 'b' ? -28 : 0;
      this.telemetry.roll = dir === 'r' ? 28 : dir === 'l' ? -28 : 0;
      this.onLog('info', `SIM <- ok (Performed flip ${dir})`);
      this.emitTelemetry();
      return;
    }

    this.onLog('info', 'SIM <- ok');
  }

  private stepPhysics(dt: number): void {
    if (!this.connected) return;

    if (this.inFlight) {
      const speedScale = 2.2;
      const yawRad = (this.telemetry.yaw * Math.PI) / 180;

      const forwardSpeed = this.rc.fb * speedScale;
      const rightSpeed = this.rc.lr * speedScale;
      const upSpeed = this.rc.ud * speedScale;

      const vx = forwardSpeed * Math.sin(yawRad) + rightSpeed * Math.cos(yawRad);
      const vy = forwardSpeed * Math.cos(yawRad) - rightSpeed * Math.sin(yawRad);

      this.telemetry.posX = Math.max(-250, Math.min(250, this.telemetry.posX + vx * dt));
      this.telemetry.posY = Math.max(-250, Math.min(250, this.telemetry.posY + vy * dt));
      this.telemetry.posZ = Math.max(20, Math.min(300, this.telemetry.posZ + upSpeed * dt));

      this.telemetry.yaw = (this.telemetry.yaw + this.rc.yaw * 1.1 * dt + 360) % 360;
      if (this.telemetry.yaw > 180) this.telemetry.yaw -= 360;

      const targetPitch = (this.rc.fb / 100) * 18;
      const targetRoll = (this.rc.lr / 100) * 18;
      this.telemetry.pitch += (targetPitch - this.telemetry.pitch) * 0.35;
      this.telemetry.roll += (targetRoll - this.telemetry.roll) * 0.35;

      this.telemetry.vgx = Math.round(vx);
      this.telemetry.vgy = Math.round(vy);
      this.telemetry.vgz = Math.round(upSpeed);
      this.telemetry.height = Math.round(this.telemetry.posZ);
      this.telemetry.tof = Math.round(this.telemetry.posZ);
      this.telemetry.baro = Number((this.telemetry.posZ / 100).toFixed(2));
      this.telemetry.flightTime = Math.floor((Date.now() - this.flightStartMs) / 1000);
      this.telemetry.battery = Math.max(5, this.telemetry.battery - 0.008);
      this.telemetry.tempHigh = Math.min(62, 41 + Math.floor(this.telemetry.flightTime / 20));
    } else {
      this.telemetry.pitch *= 0.7;
      this.telemetry.roll *= 0.7;
      this.telemetry.vgx = 0;
      this.telemetry.vgy = 0;
      this.telemetry.vgz = 0;
    }

    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.onTelemetry({
      ...this.telemetry,
      battery: Math.round(this.telemetry.battery),
      pitch: Math.round(this.telemetry.pitch),
      roll: Math.round(this.telemetry.roll),
      yaw: Math.round(this.telemetry.yaw),
      posX: Math.round(this.telemetry.posX),
      posY: Math.round(this.telemetry.posY),
      posZ: Math.round(this.telemetry.posZ),
      inFlight: this.inFlight,
      connected: this.connected,
      lastUpdated: Date.now(),
    });
  }
}
