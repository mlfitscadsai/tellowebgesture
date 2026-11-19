export type DroneMode = 'tello' | 'simulator';

export interface RcVector {
  lr: number;  // -100 to 100 (left/right)
  fb: number;  // -100 to 100 (forward/backward)
  ud: number;  // -100 to 100 (up/down)
  yaw: number; // -100 to 100 (yaw rotation)
}

export interface TelemetryData {
  battery: number;     // %
  height: number;      // cm
  tof: number;         // cm
  pitch: number;       // degrees
  roll: number;        // degrees
  yaw: number;         // degrees
  vgx: number;         // cm/s
  vgy: number;         // cm/s
  vgz: number;         // cm/s
  tempLow: number;     // °C
  tempHigh: number;    // °C
  baro: number;        // m
  flightTime: number;  // seconds
  // Virtual / estimated position for HUD visualizer (cm)
  posX: number;
  posY: number;
  posZ: number;
  inFlight: boolean;
  mode: DroneMode;
  connected: boolean;
  lastUpdated: number;
}

export type ClientMessage =
  | { type: 'connect'; mode: DroneMode; host?: string; port?: number }
  | { type: 'disconnect' }
  | { type: 'command'; command: string }
  | { type: 'rc'; lr: number; fb: number; ud: number; yaw: number }
  | { type: 'ping'; clientTime: number };

export type ServerMessage =
  | {
      type: 'status';
      connected: boolean;
      mode: DroneMode;
      inFlight: boolean;
      host: string;
      port: number;
      message?: string;
    }
  | { type: 'telemetry'; data: TelemetryData }
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'cmd'; text: string; timestamp: number }
  | { type: 'command_result'; command: string; ok: boolean; response: string }
  | { type: 'pong'; clientTime: number; serverTime: number };

export interface DroneController {
  readonly mode: DroneMode;
  readonly connected: boolean;
  readonly inFlight: boolean;
  readonly host: string;
  readonly port: number;
  connect(host?: string, port?: number): Promise<{ ok: boolean; message: string }>;
  disconnect(): Promise<void>;
  sendCommand(command: string): Promise<{ ok: boolean; response: string }>;
  sendRc(rc: RcVector): void;
  getTelemetry(): TelemetryData;
  onTelemetry(cb: (data: TelemetryData) => void): void;
  onLog(cb: (level: 'info' | 'warn' | 'error' | 'cmd', text: string) => void): void;
}
