import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowUpDown,
  Battery,
  Camera,
  CameraOff,
  Clock,
  Gamepad2,
  Hand,
  PauseCircle,
  PlaneLanding,
  PlaneTakeoff,
  RotateCcw,
  RotateCw,
  Settings2,
  Sliders,
  SwitchCamera,
  Terminal,
  Thermometer,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useTelloSocket } from '../hooks/useTelloSocket';
import {
  GESTURE_CATALOG,
  GestureBuffer,
  KeyPointClassifier,
  gestureIdToRc,
} from '../ml/keypointClassifier';
import { OfflineHandTracker, drawHandOverlay } from '../ml/handTracker';
import type { ControlMode, DroneMode, FlightSettings, GesturePrediction, RcVector } from '../types/tello';
import { ConfirmDialog } from './ConfirmDialog';
import { DroneHudVisualizer } from './DroneHudVisualizer';
import { GestureSymbol } from './GestureSymbol';
import { SetupDialog } from './SetupDialog';

interface FlightCockpitProps {
  initialMode: DroneMode;
  onBackToLanding: () => void;
}

const ZERO_RC: RcVector = { lr: 0, fb: 0, ud: 0, yaw: 0 };

export function FlightCockpit({ initialMode, onBackToLanding }: FlightCockpitProps) {
  const socket = useTelloSocket();
  const { sendRc, sendCommand, connectDrone, disconnectDrone, clearLogs } = socket;

  const [selectedMode, setSelectedMode] = useState<DroneMode>(initialMode);
  const [controlMode, setControlMode] = useState<ControlMode>('gesture');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [mlReady, setMlReady] = useState(false);
  const [mlError, setMlError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);

  const [prediction, setPrediction] = useState<GesturePrediction>({
    id: -1,
    label: 'No Hand',
    confidence: 0,
    probabilities: [],
  });
  const [confirmedGestureId, setConfirmedGestureId] = useState<number>(-1);
  const [bufferStability, setBufferStability] = useState(0);
  const [activeRc, setActiveRc] = useState<RcVector>(ZERO_RC);

  const [settings, setSettings] = useState<FlightSettings>({
    speedScale: 1.0,
    minConfidence: 0.65,
    bufferLength: 5,
    mirrorCamera: true,
    showLandmarks: true,
  });

  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'takeoff' | 'emergency' | null>(null);

  // Refs for real-time 60fps loop without re-creating closures
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraStartingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const trackerRef = useRef<OfflineHandTracker | null>(null);
  const classifierRef = useRef<KeyPointClassifier | null>(null);
  const bufferRef = useRef<GestureBuffer>(new GestureBuffer(5));
  const settingsRef = useRef(settings);
  const controlModeRef = useRef(controlMode);
  const inFlightRef = useRef(socket.inFlight);
  const droneConnectedRef = useRef(socket.droneConnected);
  const modeRef = useRef(socket.mode);
  const lastLandTriggerRef = useRef(0);
  const keysPressedRef = useRef<Set<string>>(new Set());

  settingsRef.current = settings;
  controlModeRef.current = controlMode;
  inFlightRef.current = socket.inFlight;
  droneConnectedRef.current = socket.droneConnected;
  modeRef.current = socket.mode;

  // Keep UDP console scrolled to the latest entry
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: 'end' });
  }, [socket.logs.length]);

  useEffect(() => {
    bufferRef.current.setBufferLength(settings.bufferLength);
  }, [settings.bufferLength]);

  // Track browser online/offline state (shows users offline mode works seamlessly on Tello Wi-Fi)
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Auto-start 100% in-browser simulator immediately when launched in simulator mode (zero backend needed)
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (!autoConnectedRef.current && initialMode === 'simulator') {
      autoConnectedRef.current = true;
      connectDrone('simulator');
    }
  }, [initialMode, connectDrone]);

  // Load offline ML assets once
  useEffect(() => {
    let cancelled = false;
    const loadMl = async () => {
      try {
        const classifier = new KeyPointClassifier();
        const tracker = new OfflineHandTracker();
        await Promise.all([classifier.load(), tracker.init(0.6)]);
        if (cancelled) {
          tracker.close();
          return;
        }
        classifierRef.current = classifier;
        trackerRef.current = tracker;
        setMlReady(true);
      } catch (err) {
        if (!cancelled) {
          setMlError(`ML initialization failed: ${String(err)}`);
        }
      }
    };
    void loadMl();

    return () => {
      cancelled = true;
      trackerRef.current?.close();
      trackerRef.current = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    cameraStartingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setFps(0);
    setPrediction({ id: -1, label: 'Camera Off', confidence: 0, probabilities: [] });
    setConfirmedGestureId(-1);
    setBufferStability(0);
    setActiveRc(ZERO_RC);
    if (droneConnectedRef.current) {
      sendRc(ZERO_RC);
    }
  }, [sendRc]);

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [] as MediaDeviceInfo[];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter((d) => d.kind === 'videoinput');
      setCameras(videoInputs);
      return videoInputs;
    } catch {
      return [] as MediaDeviceInfo[];
    }
  }, []);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

  const startCamera = useCallback(async (deviceIdOverride?: string, facingOverride?: 'user' | 'environment') => {
    if (cameraStartingRef.current) return;
    cameraStartingRef.current = true;
    setCameraError(null);

    const targetDeviceId = deviceIdOverride !== undefined ? deviceIdOverride : selectedDeviceId;
    const targetFacing = facingOverride ?? facingMode;
    const isMobileViewport = window.matchMedia('(max-width: 820px)').matches;
    const idealDims = isMobileViewport
      ? { width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 960 }, height: { ideal: 540 } };

    const acquireStream = async (): Promise<MediaStream> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Webcam API requires localhost or HTTPS in this browser.');
      }

      const attempts: MediaStreamConstraints[] = targetDeviceId
        ? [
            { video: { deviceId: { exact: targetDeviceId }, ...idealDims }, audio: false },
            { video: { deviceId: { exact: targetDeviceId } }, audio: false },
          ]
        : isMobileViewport || facingOverride !== undefined
          ? [
              { video: { facingMode: { ideal: targetFacing }, ...idealDims }, audio: false },
              { video: { facingMode: targetFacing }, audio: false },
              { video: true, audio: false },
            ]
          : [
              { video: { ...idealDims }, audio: false },
              { video: true, audio: false },
            ];

      let lastErr: unknown;
      for (const constraints of attempts) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          lastErr = err;
          // Don't retry if user explicitly denied permission
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            throw err;
          }
        }
      }

      // Final fallback: try each detected camera individually (skips broken Continuity/virtual default)
      if (!targetDeviceId) {
        const detected = await refreshCameras();
        // Prefer built-in FaceTime / integrated cameras first
        const sorted = [...detected].sort((a, b) => {
          const score = (l: string) => (/facetime|built-in|integrated|hd camera/i.test(l) ? 0 : 1);
          return score(a.label) - score(b.label);
        });
        for (const cam of sorted) {
          if (!cam.deviceId) continue;
          try {
            const s = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: cam.deviceId } },
              audio: false,
            });
            setSelectedDeviceId(cam.deviceId);
            return s;
          } catch (err) {
            lastErr = err;
          }
        }
      }

      throw lastErr;
    };

    try {
      // Clean up any prior stream before requesting a fresh one
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await acquireStream();

      // Refresh camera labels now that permission has been granted
      void refreshCameras();
      const activeTrackId = stream.getVideoTracks()[0]?.getSettings()?.deviceId;
      if (activeTrackId && !targetDeviceId) {
        setSelectedDeviceId(activeTrackId);
      }

      // If user navigated away while permission prompt was open, stop tracks cleanly
      if (!videoRef.current || !cameraStartingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;

      // Wait for metadata before calling play() to avoid Safari/WebKit AbortError
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 2500);
          video.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }

      try {
        await video.play();
      } catch (playErr) {
        // Ignore harmless AbortError if autoPlay already started playback
        if (!(playErr instanceof DOMException && playErr.name === 'AbortError' && !video.paused)) {
          throw playErr;
        }
      }

      setCameraActive(true);
    } catch (err) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const errName = err instanceof DOMException ? err.name : 'Error';
      const errMsg = err instanceof Error ? err.message : String(err);
      let hint = '';
      if (errName === 'AbortError' || errName === 'NotReadableError') {
        hint =
          ' Tip: Close other apps using your camera, select your built-in MacBook camera above (avoid unavailable iPhone Continuity Camera), or verify macOS System Settings → Privacy & Security → Camera.';
      } else if (errName === 'NotAllowedError') {
        hint = ' Tip: Allow camera access in your browser address bar and reload.';
      }
      setCameraError(`Camera error (${errName}): ${errMsg}.${hint}`);
    } finally {
      cameraStartingRef.current = false;
    }
  }, [selectedDeviceId, facingMode, refreshCameras]);

  const handleFlipCamera = useCallback(() => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    setSelectedDeviceId('');
    setSettings((s) => ({ ...s, mirrorCamera: nextFacing === 'user' }));
    if (cameraActive) {
      stopCamera();
      void startCamera('', nextFacing);
    }
  }, [facingMode, cameraActive, stopCamera, startCamera]);

  const startTouchRc = useCallback(
    (partial: Partial<RcVector>) => {
      if (!droneConnectedRef.current || !inFlightRef.current) return;
      const spd = Math.round(35 * settingsRef.current.speedScale);
      const yawSpd = Math.round(45 * settingsRef.current.speedScale);
      const rc: RcVector = {
        lr: (partial.lr ?? 0) * spd,
        fb: (partial.fb ?? 0) * spd,
        ud: (partial.ud ?? 0) * spd,
        yaw: (partial.yaw ?? 0) * yawSpd,
      };
      setActiveRc(rc);
      sendRc(rc);
    },
    [sendRc],
  );

  const stopTouchRc = useCallback(() => {
    setActiveRc(ZERO_RC);
    if (droneConnectedRef.current) {
      sendRc(ZERO_RC);
    }
  }, [sendRc]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Real-time Hand Tracking & Gesture Inference Loop
  useEffect(() => {
    if (!cameraActive) return;

    let lastVideoTime = -1;
    let frameCount = 0;
    let lastFpsAt = performance.now();

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const tracker = trackerRef.current;
      const classifier = classifierRef.current;

      if (!video || !canvas || video.readyState < 2) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      frameCount++;
      if (now - lastFpsAt >= 500) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsAt)));
        frameCount = 0;
        lastFpsAt = now;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!tracker || !classifier) return;

      const result = tracker.detectForVideo(video, now);
      const landmarks = result?.landmarks?.[0];
      const cfg = settingsRef.current;

      if (landmarks && landmarks.length === 21) {
        const pred = classifier.classify(landmarks, canvas.width, canvas.height, cfg.mirrorCamera);
        const meetsThreshold = pred.confidence >= cfg.minConfidence;
        const effectiveId = meetsThreshold ? pred.id : -1;

        setPrediction(pred);

        const spec = GESTURE_CATALOG.find((g) => g.id === pred.id);
        if (cfg.showLandmarks) {
          drawHandOverlay(
            ctx,
            landmarks,
            canvas.width,
            canvas.height,
            cfg.mirrorCamera,
            meetsThreshold ? pred.label : `${pred.label} (low)`,
            pred.confidence,
            meetsThreshold ? (spec?.color ?? '#22d3ee') : '#94a3b8',
          );
        }

        const bufResult = bufferRef.current.push(effectiveId);
        setBufferStability(bufResult.stability);

        if (bufResult.confirmedId !== null) {
          setConfirmedGestureId(bufResult.confirmedId);

          if (controlModeRef.current === 'gesture' && droneConnectedRef.current && inFlightRef.current) {
            if (bufResult.confirmedId === 3) {
              // Land gesture (debounced 2s)
              if (now - lastLandTriggerRef.current > 2000) {
                lastLandTriggerRef.current = now;
                setActiveRc(ZERO_RC);
                sendRc(ZERO_RC);
                sendCommand('land');
              }
            } else if (bufResult.confirmedId === -1) {
              setActiveRc(ZERO_RC);
              sendRc(ZERO_RC);
            } else {
              const rc = gestureIdToRc(bufResult.confirmedId, cfg.speedScale);
              setActiveRc(rc);
              sendRc(rc);
            }
          }
        }
      } else {
        setPrediction({ id: -1, label: 'No Hand', confidence: 0, probabilities: [] });
        const bufResult = bufferRef.current.push(-1);
        setBufferStability(bufResult.stability);
        if (bufResult.confirmedId === -1) {
          setConfirmedGestureId(-1);
          if (controlModeRef.current === 'gesture' && droneConnectedRef.current) {
            setActiveRc(ZERO_RC);
            sendRc(ZERO_RC);
          }
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [cameraActive, sendRc, sendCommand]);

  // Keyboard Control Loop (W/A/S/D, R/F, Q/E, Space, G/K/H, Esc)
  useEffect(() => {
    const computeKeyboardRc = (): RcVector => {
      const keys = keysPressedRef.current;
      const spd = Math.round(35 * settingsRef.current.speedScale);
      const yawSpd = Math.round(45 * settingsRef.current.speedScale);
      let lr = 0;
      let fb = 0;
      let ud = 0;
      let yaw = 0;

      if (keys.has('w') || keys.has('arrowup')) fb += spd;
      if (keys.has('s') || keys.has('arrowdown')) fb -= spd;
      if (keys.has('d') || keys.has('arrowright')) lr += spd;
      if (keys.has('a') || keys.has('arrowleft')) lr -= spd;
      if (keys.has('r')) ud += spd;
      if (keys.has('f')) ud -= spd;
      if (keys.has('e')) yaw += yawSpd;
      if (keys.has('q')) yaw -= yawSpd;

      return { lr, fb, ud, yaw };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();

      if (key === 'g') {
        setControlMode('gesture');
        return;
      }
      if (key === 'k') {
        setControlMode('keyboard');
        sendRc(ZERO_RC);
        setActiveRc(ZERO_RC);
        return;
      }
      if (key === 'h') {
        setControlMode('hover');
        sendRc(ZERO_RC);
        setActiveRc(ZERO_RC);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        if (!droneConnectedRef.current) return;
        if (inFlightRef.current) {
          sendCommand('land');
        } else if (modeRef.current === 'tello') {
          setConfirmAction('takeoff');
        } else {
          sendCommand('takeoff');
        }
        return;
      }
      if (key === 'escape' && droneConnectedRef.current) {
        sendRc(ZERO_RC);
        setActiveRc(ZERO_RC);
        if (inFlightRef.current) {
          sendCommand('land');
        }
        return;
      }

      if (controlModeRef.current === 'keyboard' && droneConnectedRef.current && inFlightRef.current) {
        if (['w', 'a', 's', 'd', 'r', 'f', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
          e.preventDefault();
          keysPressedRef.current.add(key);
          const rc = computeKeyboardRc();
          setActiveRc(rc);
          sendRc(rc);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (keysPressedRef.current.has(key)) {
        keysPressedRef.current.delete(key);
        if (controlModeRef.current === 'keyboard' && droneConnectedRef.current) {
          const rc = computeKeyboardRc();
          setActiveRc(rc);
          sendRc(rc);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sendRc, sendCommand]);

  const handleModeSwitch = (mode: DroneMode) => {
    setSelectedMode(mode);
    if (socket.droneConnected) {
      socket.disconnectDrone();
    }
  };

  const handleConnectToggle = () => {
    if (socket.droneConnected) {
      socket.disconnectDrone();
    } else if (selectedMode === 'tello') {
      setSetupOpen(true);
    } else {
      socket.connectDrone('simulator');
    }
  };

  const handleTakeoffClick = () => {
    if (!socket.droneConnected) return;
    if (socket.inFlight) {
      socket.sendCommand('land');
    } else if (socket.mode === 'tello') {
      setConfirmAction('takeoff');
    } else {
      socket.sendCommand('takeoff');
    }
  };

  const updateRangeProgress = (e: React.ChangeEvent<HTMLInputElement>) => {
    const min = Number(e.target.min) || 0;
    const max = Number(e.target.max) || 100;
    const val = Number(e.target.value);
    const pct = ((val - min) / (max - min)) * 100;
    e.target.style.setProperty('--progress', `${pct}%`);
  };

  const activeSpec = GESTURE_CATALOG.find((g) => g.id === confirmedGestureId);

  return (
    <div className="cockpit-shell">
      {/* Top Flight Control & Telemetry Bar */}
      <header className="cockpit-topbar">
        <div className="topbar-left">
          <button type="button" className="icon-btn" onClick={onBackToLanding} aria-label="Back to landing page">
            <ArrowLeft size={18} />
          </button>
          <div className="brand-mark compact">
            <img src="/logo.png" alt="AeroHand logo" className="brand-logo compact" width={28} height={28} />
            <span>AeroHand Cockpit</span>
          </div>

          <div className="segmented-control" role="group" aria-label="Drone connection mode">
            <button
              type="button"
              className={selectedMode === 'tello' ? 'active' : ''}
              onClick={() => handleModeSwitch('tello')}
            >
              <Wifi size={14} /> Real Tello
            </button>
            <button
              type="button"
              className={selectedMode === 'simulator' ? 'active' : ''}
              onClick={() => handleModeSwitch('simulator')}
            >
              <Zap size={14} /> Simulator
            </button>
          </div>

          <button
            type="button"
            className={`btn btn-sm ${socket.droneConnected ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleConnectToggle}
          >
            {socket.droneConnected ? (
              <>
                <WifiOff size={14} /> Disconnect
              </>
            ) : (
              <>
                <Wifi size={14} /> {selectedMode === 'tello' ? 'Connect Tello Wi-Fi' : 'Start Simulator'}
              </>
            )}
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setSetupOpen(true)}
            aria-label="Tello Wi-Fi diagnostics"
            title="Tello Wi-Fi Setup & Diagnostics"
          >
            <Settings2 size={17} />
          </button>
        </div>

        {/* Live Telemetry Strip */}
        <div className="telemetry-strip" role="status" aria-live="polite">
          <div className={`tele-pill ${socket.telemetry.battery > 0 && socket.telemetry.battery < 20 ? 'warn' : ''}`}>
            <Battery size={14} />
            <span>{socket.droneConnected ? `${socket.telemetry.battery}%` : '--'}</span>
          </div>
          <div className="tele-pill">
            <ArrowUpDown size={14} />
            <span>{socket.droneConnected ? `${socket.telemetry.height}cm` : '--'}</span>
          </div>
          <div className="tele-pill">
            <Thermometer size={14} />
            <span>{socket.droneConnected ? `${socket.telemetry.tempHigh}°C` : '--'}</span>
          </div>
          <div className="tele-pill">
            <Clock size={14} />
            <span>{socket.droneConnected ? `${socket.telemetry.flightTime}s` : '--'}</span>
          </div>
          <div className="tele-pill mono">
            <span>{fps} FPS</span>
          </div>
        </div>

        {/* Critical Flight Actions */}
        <div className="topbar-right">
          <button
            type="button"
            className={`btn btn-sm ${socket.inFlight ? 'btn-warning' : 'btn-success'}`}
            onClick={handleTakeoffClick}
            disabled={!socket.droneConnected}
          >
            {socket.inFlight ? (
              <>
                <PlaneLanding size={15} /> Land
              </>
            ) : (
              <>
                <PlaneTakeoff size={15} /> Takeoff
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => setConfirmAction('emergency')}
            disabled={!socket.droneConnected}
            title="Emergency motor cutoff"
          >
            <AlertOctagon size={15} /> E-STOP
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="cockpit-grid">
        {/* Left/Center: Webcam + HUD + Radar */}
        <section className="stage-column">
          <div className="camera-card">
            <div className="camera-toolbar">
              <div className="camera-status-group">
                <span className={`status-pill ${socket.droneConnected ? 'live' : ''}`}>
                  <span className="pulse-dot" />
                  {socket.droneConnected
                    ? `${socket.mode === 'tello' ? 'TELLO WI-FI' : 'SIMULATOR'} • ${socket.inFlight ? 'IN FLIGHT' : 'LANDED'}`
                    : 'DRONE OFFLINE'}
                </span>
                <span className="status-pill subtle">
                  {mlReady
                    ? isOnline
                      ? 'In-Browser ML Ready'
                      : 'Offline ML Active ✓'
                    : mlError
                      ? 'ML Error'
                      : 'Loading In-Browser ML...'}
                </span>
              </div>

              <div className="camera-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={handleFlipCamera}
                  aria-label="Switch front and rear camera"
                  title={`Switch camera (currently ${facingMode === 'user' ? 'Front' : 'Rear'})`}
                >
                  <SwitchCamera size={16} />
                </button>
                {cameras.length > 1 && (
                  <select
                    className="camera-select"
                    aria-label="Select webcam"
                    value={selectedDeviceId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedDeviceId(nextId);
                      if (cameraActive) {
                        stopCamera();
                        void startCamera(nextId);
                      }
                    }}
                  >
                    <option value="">Default Camera</option>
                    {cameras.map((cam, idx) => (
                      <option key={cam.deviceId || idx} value={cam.deviceId}>
                        {cam.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className={`btn btn-sm ${cameraActive ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => (cameraActive ? stopCamera() : void startCamera())}
                  disabled={!mlReady}
                >
                  {cameraActive ? (
                    <>
                      <CameraOff size={15} /> Stop Camera
                    </>
                  ) : (
                    <>
                      <Camera size={15} /> Start Webcam
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="video-viewport">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`webcam-video ${settings.mirrorCamera ? 'mirrored' : ''}`}
              />
              <canvas ref={canvasRef} className="landmark-canvas" />

              {!cameraActive && (
                <div className="video-placeholder">
                  <Camera size={44} className="accent-icon" />
                  <h3>Enable Your Webcam to Control with Hand Gestures</h3>
                  <p>
                    All video stays 100% private on your device. MediaPipe tracks 21 hand landmarks locally and sends
                    only lightweight RC velocity vectors to your Tello.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void startCamera()}
                    disabled={!mlReady}
                  >
                    <Camera size={16} /> {mlReady ? 'Start Hand Tracking Camera' : 'Loading Local ML Models...'}
                  </button>
                  {(cameraError || mlError) && (
                    <p className="error-text" role="alert">
                      {cameraError || mlError}
                    </p>
                  )}
                </div>
              )}

              {/* Active Gesture HUD Overlay */}
              {cameraActive && (
                <div className="hud-overlay-bottom">
                  <div className="gesture-hud-pill">
                    <span className="hud-label">DETECTED</span>
                    {activeSpec && <GestureSymbol gestureId={activeSpec.id} fallback={activeSpec.symbol} size={22} />}
                    <strong style={{ color: activeSpec?.color ?? 'var(--text-primary)' }}>
                      {prediction.label}
                    </strong>
                    <span className="hud-conf">
                      {prediction.id >= 0 ? `${Math.round(prediction.confidence * 100)}%` : '--'}
                    </span>
                  </div>

                  <div className="stability-wrap" aria-label="Gesture stability buffer">
                    <span className="hud-label">BUFFER LOCK</span>
                    <div className="stability-track">
                      <div
                        className="stability-fill"
                        style={{
                          width: `${Math.round(bufferStability * 100)}%`,
                          backgroundColor: activeSpec?.color ?? 'var(--accent)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Attitude, Radar & Gesture Reference Bar */}
          <DroneHudVisualizer telemetry={socket.telemetry} activeRc={activeRc} />

          <div className="quick-gesture-strip" aria-label="8 supported hand gestures">
            {GESTURE_CATALOG.map((g) => {
              const isMatch = confirmedGestureId === g.id;
              return (
                <div
                  key={g.id}
                  className={`mini-gesture-chip ${isMatch ? 'active' : ''}`}
                  title={`${g.label} — ${g.poseHint}`}
                  style={
                    isMatch
                      ? {
                          borderColor: g.color,
                          boxShadow: `0 0 0 1px ${g.color}, 0 6px 20px ${g.color}28`,
                          background: `color-mix(in srgb, ${g.color} 12%, var(--surface))`,
                        }
                      : undefined
                  }
                >
                  <span className="mini-gesture-symbol">
                    <GestureSymbol gestureId={g.id} fallback={g.symbol} size={28} />
                  </span>
                  <span className="mini-gesture-title" style={isMatch ? { color: g.color } : undefined}>
                    {g.label}
                  </span>
                  <span className="mini-gesture-pose">{g.shortPose}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Sidebar: Control Mode, Maneuvers, Settings, Console */}
        <aside className="sidebar-column">
          {/* Control Mode Selector */}
          <div className="panel-card">
            <div className="panel-title">
              <Hand size={16} className="accent-icon" />
              <span>Control Input Mode</span>
            </div>
            <div className="mode-grid">
              <button
                type="button"
                className={`mode-btn ${controlMode === 'gesture' ? 'active' : ''}`}
                onClick={() => setControlMode('gesture')}
              >
                <Hand size={16} />
                <span>Gesture (G)</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${controlMode === 'keyboard' ? 'active' : ''}`}
                onClick={() => {
                  setControlMode('keyboard');
                  sendRc(ZERO_RC);
                  setActiveRc(ZERO_RC);
                }}
              >
                <Gamepad2 size={16} />
                <span>Manual / Touch (K)</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${controlMode === 'hover' ? 'active' : ''}`}
                onClick={() => {
                  setControlMode('hover');
                  sendRc(ZERO_RC);
                  setActiveRc(ZERO_RC);
                }}
              >
                <PauseCircle size={16} />
                <span>Hover Lock (H)</span>
              </button>
            </div>
            {controlMode === 'keyboard' && (
              <>
                <div className="touch-dpad-wrap" aria-label="Touch flight controls">
                  <div className="touch-dpad">
                    <span />
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ fb: 1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      ↑ Fwd
                    </button>
                    <span />
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ lr: -1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      ← Left
                    </button>
                    <button
                      type="button"
                      className="dpad-btn dpad-stop"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onClick={() => {
                        stopTouchRc();
                        sendCommand('stop');
                      }}
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ lr: 1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      Right →
                    </button>
                    <span />
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ fb: -1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      ↓ Back
                    </button>
                    <span />
                  </div>
                  <div className="touch-alt-yaw">
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ ud: 1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ ud: -1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ yaw: -1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      ↺ CCW
                    </button>
                    <button
                      type="button"
                      className="dpad-btn"
                      disabled={!socket.droneConnected || !socket.inFlight}
                      onPointerDown={() => startTouchRc({ yaw: 1 })}
                      onPointerUp={stopTouchRc}
                      onPointerLeave={stopTouchRc}
                      onPointerCancel={stopTouchRc}
                    >
                      ↻ CW
                    </button>
                  </div>
                </div>
                <p className="keyboard-hint">
                  Desktop keys: <code>W/A/S/D</code> Move • <code>R/F</code> Up/Down • <code>Q/E</code> Yaw •{' '}
                  <code>Space</code> Takeoff/Land
                </p>
              </>
            )}
          </div>

          {/* Quick Flight Maneuvers */}
          <div className="panel-card">
            <div className="panel-title">
              <Zap size={16} className="accent-icon" />
              <span>Quick Maneuvers</span>
            </div>
            <div className="maneuver-grid">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!socket.droneConnected || !socket.inFlight}
                onClick={() => {
                  socket.sendRc(ZERO_RC);
                  setActiveRc(ZERO_RC);
                  socket.sendCommand('stop');
                }}
              >
                Hover Stop
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!socket.droneConnected || !socket.inFlight}
                onClick={() => socket.sendCommand('flip f')}
              >
                Flip Forward
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!socket.droneConnected || !socket.inFlight}
                onClick={() => socket.sendCommand('flip l')}
              >
                <RotateCcw size={13} /> Flip Left
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!socket.droneConnected || !socket.inFlight}
                onClick={() => socket.sendCommand('flip r')}
              >
                <RotateCw size={13} /> Flip Right
              </button>
            </div>
          </div>

          {/* Flight & ML Tuning Settings */}
          <div className="panel-card">
            <div className="panel-title">
              <Sliders size={16} className="accent-icon" />
              <span>Flight &amp; Gesture Tuning</span>
            </div>

            <div className="settings-list">
              <label className="slider-row">
                <div className="slider-head">
                  <span>Speed Scale</span>
                  <strong>{Math.round(settings.speedScale * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="1.5"
                  step="0.1"
                  value={settings.speedScale}
                  onChange={(e) => {
                    updateRangeProgress(e);
                    setSettings((s) => ({ ...s, speedScale: Number(e.target.value) }));
                  }}
                />
              </label>

              <label className="slider-row">
                <div className="slider-head">
                  <span>Min Confidence</span>
                  <strong>{Math.round(settings.minConfidence * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="0.45"
                  max="0.95"
                  step="0.05"
                  value={settings.minConfidence}
                  onChange={(e) => {
                    updateRangeProgress(e);
                    setSettings((s) => ({ ...s, minConfidence: Number(e.target.value) }));
                  }}
                />
              </label>

              <label className="slider-row">
                <div className="slider-head">
                  <span>Stability Buffer</span>
                  <strong>{settings.bufferLength} frames</strong>
                </div>
                <input
                  type="range"
                  min="3"
                  max="12"
                  step="1"
                  value={settings.bufferLength}
                  onChange={(e) => {
                    updateRangeProgress(e);
                    setSettings((s) => ({ ...s, bufferLength: Number(e.target.value) }));
                  }}
                />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  className="visually-hidden-fallback"
                  checked={settings.mirrorCamera}
                  onChange={(e) => setSettings((s) => ({ ...s, mirrorCamera: e.target.checked }))}
                />
                <span>Mirror Webcam View</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  className="visually-hidden-fallback"
                  checked={settings.showLandmarks}
                  onChange={(e) => setSettings((s) => ({ ...s, showLandmarks: e.target.checked }))}
                />
                <span>Draw Hand Skeleton Overlay</span>
              </label>
            </div>
          </div>

          {/* Live Command & Telemetry Console */}
          <div className="panel-card console-card">
            <div className="panel-title-between">
              <div className="panel-title">
                <Terminal size={16} className="accent-icon" />
                <span>UDP Command Console</span>
              </div>
              <button type="button" className="text-btn" onClick={clearLogs}>
                Clear
              </button>
            </div>
            <div className="console-log" role="log" aria-live="polite">
              {socket.logs.length === 0 ? (
                <div className="log-empty">Waiting for bridge events...</div>
              ) : (
                socket.logs.map((entry) => (
                  <div key={entry.id} className={`log-line log-${entry.level}`}>
                    <span className="log-time">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span className="log-text">{entry.text}</span>
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </aside>
      </div>

      {/* Native Accessible Modals */}
      <SetupDialog
        open={setupOpen}
        host={socket.host}
        port={socket.port}
        onClose={() => setSetupOpen(false)}
        onConnectTello={(h, p) => {
          setSelectedMode('tello');
          socket.connectDrone('tello', h, p);
        }}
      />

      <ConfirmDialog
        open={confirmAction === 'takeoff'}
        title="Confirm Real Drone Takeoff"
        description="Make sure your DJI Tello is on a flat surface with at least 2 meters of clear space and no bystanders nearby. Ready to spin propellers and take off?"
        confirmLabel="Take Off Now"
        onConfirm={() => {
          setConfirmAction(null);
          socket.sendCommand('takeoff');
        }}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'emergency'}
        title="Emergency Motor Cutoff"
        description="This immediately stops all propellers and the drone will drop from its current altitude. Use only in an emergency!"
        confirmLabel="CUT MOTORS NOW"
        danger
        onConfirm={() => {
          setConfirmAction(null);
          socket.sendRc(ZERO_RC);
          setActiveRc(ZERO_RC);
          socket.sendCommand('emergency');
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
