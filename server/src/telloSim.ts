import type { DroneController, DroneMode, RcVector, TelemetryData } from './types.js';

export class TelloSimulatorController implements DroneController {
  public readonly mode: DroneMode = 'simulator';
  public host = '127.0.0.1 (Virtual Tello)';
  public port = 8889;
  public connected = false;
  public inFlight = false;

  private tickTimer: NodeJS.Timeout | null = null;
  private rc: RcVector = { lr: 0, fb: 0, ud: 0, yaw: 0 };
  private flightStartMs = 0;

  private telemetryCb: ((data: TelemetryData) => void) | null = null;
  private logCb: ((level: 'info' | 'warn' | 'error' | 'cmd', text: string) => void) | null = null;

  private telemetry: TelemetryData = {
    battery: 94,
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

  public async connect(): Promise<{ ok: boolean; message: string }> {
    await this.disconnect();
    this.connected = true;
    this.inFlight = false;
    this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
    this.telemetry = {
      ...this.telemetry,
      battery: 94,
      height: 0,
      tof: 10,
      pitch: 0,
      roll: 0,
      yaw: 0,
      posX: 0,
      posY: 0,
      posZ: 0,
      flightTime: 0,
      inFlight: false,
      connected: true,
      lastUpdated: Date.now(),
    };

    this.log('info', 'Virtual Tello Simulator connected. Safe dry-run physics enabled.');

    this.tickTimer = setInterval(() => this.stepPhysics(0.1), 100);
    return { ok: true, message: 'Connected to Virtual Tello Simulator' };
  }

  public async disconnect(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.connected = false;
    this.inFlight = false;
    this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
    this.telemetry.connected = false;
    this.telemetry.inFlight = false;
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

  public async sendCommand(command: string): Promise<{ ok: boolean; response: string }> {
    const clean = command.trim().toLowerCase();
    if (!this.connected) {
      return { ok: false, response: 'Simulator not connected' };
    }

    this.log('cmd', `SIM -> ${clean}`);

    if (clean === 'takeoff') {
      if (this.inFlight) return { ok: true, response: 'ok' };
      this.inFlight = true;
      this.flightStartMs = Date.now();
      this.telemetry.posZ = 95;
      this.telemetry.height = 95;
      this.telemetry.tof = 95;
      this.log('info', 'SIM <- ok (Takeoff complete, hovering at 95 cm)');
      this.emitTelemetry();
      return { ok: true, response: 'ok' };
    }

    if (clean === 'land') {
      this.inFlight = false;
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.telemetry.posZ = 0;
      this.telemetry.height = 0;
      this.telemetry.tof = 10;
      this.telemetry.pitch = 0;
      this.telemetry.roll = 0;
      this.log('info', 'SIM <- ok (Landed safely)');
      this.emitTelemetry();
      return { ok: true, response: 'ok' };
    }

    if (clean === 'emergency') {
      this.inFlight = false;
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.telemetry.posZ = 0;
      this.telemetry.height = 0;
      this.telemetry.tof = 10;
      this.log('warn', 'SIM <- ok (EMERGENCY motor cutoff)');
      this.emitTelemetry();
      return { ok: true, response: 'ok' };
    }

    if (clean === 'stop') {
      this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0 };
      this.log('info', 'SIM <- ok (Hover stop)');
      return { ok: true, response: 'ok' };
    }

    if (clean.startsWith('flip ')) {
      if (!this.inFlight) {
        return { ok: false, response: 'error: must be in flight to flip' };
      }
      const dir = clean.split(' ')[1];
      this.telemetry.pitch = dir === 'f' ? 28 : dir === 'b' ? -28 : 0;
      this.telemetry.roll = dir === 'r' ? 28 : dir === 'l' ? -28 : 0;
      this.log('info', `SIM <- ok (Performed flip ${dir})`);
      this.emitTelemetry();
      return { ok: true, response: 'ok' };
    }

    if (clean === 'battery?') {
      return { ok: true, response: String(Math.round(this.telemetry.battery)) };
    }

    this.log('info', 'SIM <- ok');
    return { ok: true, response: 'ok' };
  }

  private stepPhysics(dt: number): void {
    if (!this.connected) return;

    if (this.inFlight) {
      const speedScale = 2.2; // cm/s per RC unit
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

      // Smooth attitude response
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
    this.telemetry.lastUpdated = Date.now();
    this.telemetry.inFlight = this.inFlight;
    this.telemetry.connected = this.connected;
    this.telemetryCb?.({
      ...this.telemetry,
      battery: Math.round(this.telemetry.battery),
      pitch: Math.round(this.telemetry.pitch),
      roll: Math.round(this.telemetry.roll),
      yaw: Math.round(this.telemetry.yaw),
      posX: Math.round(this.telemetry.posX),
      posY: Math.round(this.telemetry.posY),
      posZ: Math.round(this.telemetry.posZ),
    });
  }
}
