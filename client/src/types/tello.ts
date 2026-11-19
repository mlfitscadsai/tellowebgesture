export type DroneMode = 'tello' | 'simulator';
export type ControlMode = 'gesture' | 'keyboard' | 'hover';

export interface RcVector {
  lr: number;
  fb: number;
  ud: number;
  yaw: number;
}

export interface TelemetryData {
  battery: number;
  height: number;
  tof: number;
  pitch: number;
  roll: number;
  yaw: number;
  vgx: number;
  vgy: number;
  vgz: number;
  tempLow: number;
  tempHigh: number;
  baro: number;
  flightTime: number;
  posX: number;
  posY: number;
  posZ: number;
  inFlight: boolean;
  mode: DroneMode;
  connected: boolean;
  lastUpdated: number;
}

export interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error' | 'cmd';
  text: string;
  timestamp: number;
}

export interface GesturePrediction {
  id: number; // -1 if none
  label: string;
  confidence: number;
  probabilities: number[];
}

export interface FlightSettings {
  speedScale: number; // 0.3 to 1.5
  minConfidence: number; // 0.4 to 0.95
  bufferLength: number; // 3 to 12 frames
  mirrorCamera: boolean;
  showLandmarks: boolean;
}

export interface GestureSpec {
  id: number;
  label: string;
  symbol: string;
  shortPose: string;
  action: string;
  poseHint: string;
  baseRc: RcVector;
  isLandCommand?: boolean;
  color: string;
}

export const INITIAL_TELEMETRY: TelemetryData = {
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
  mode: 'simulator',
  connected: false,
  lastUpdated: 0,
};
