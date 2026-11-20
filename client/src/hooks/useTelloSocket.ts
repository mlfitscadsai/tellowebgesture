import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserTelloSimulator } from '../sim/browserSimulator';
import {
  INITIAL_TELEMETRY,
  type DroneMode,
  type LogEntry,
  type RcVector,
  type TelemetryData,
} from '../types/tello';

interface SocketState {
  wsConnected: boolean;
  droneConnected: boolean;
  mode: DroneMode;
  inFlight: boolean;
  host: string;
  port: number;
  statusMessage: string;
  latencyMs: number | null;
  telemetry: TelemetryData;
  logs: LogEntry[];
}

/**
 * Hybrid drone transport:
 * - `simulator` mode runs 100% inside the user's browser (zero backend, works on Vercel & offline).
 * - `tello` mode connects to the local Node.js UDP bridge (`/ws` or `VITE_WS_URL`) for real DJI Tello Wi-Fi control.
 */
export function useTelloSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const simRef = useRef<BrowserTelloSimulator | null>(null);
  const activeModeRef = useRef<DroneMode>('simulator');
  const logIdRef = useRef(1);
  const pingTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<SocketState>({
    wsConnected: false,
    droneConnected: false,
    mode: 'simulator',
    inFlight: false,
    host: '192.168.10.1',
    port: 8889,
    statusMessage: '100% In-Browser Simulator ready. Switch to Real Tello for local UDP bridge.',
    latencyMs: null,
    telemetry: INITIAL_TELEMETRY,
    logs: [],
  });

  const appendLog = useCallback((level: LogEntry['level'], text: string, timestamp = Date.now()) => {
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs.slice(-79), { id: logIdRef.current++, level, text, timestamp }],
    }));
  }, []);

  // Initialize pure in-browser simulator once
  useEffect(() => {
    const sim = new BrowserTelloSimulator({
      onTelemetry: (data) => {
        if (activeModeRef.current !== 'simulator') return;
        setState((prev) => ({
          ...prev,
          telemetry: data,
          inFlight: data.inFlight,
          droneConnected: data.connected,
        }));
      },
      onLog: (level, text) => appendLog(level, text),
      onStatus: (connected, inFlight, message) => {
        if (activeModeRef.current !== 'simulator') return;
        setState((prev) => ({
          ...prev,
          droneConnected: connected,
          inFlight,
          mode: 'simulator',
          host: 'In-Browser (Offline)',
          statusMessage: message,
        }));
      },
    });
    simRef.current = sim;

    return () => {
      sim.disconnect(true);
      simRef.current = null;
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      wsRef.current?.close();
    };
  }, [appendLog]);

  const closeBridgeWs = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setState((prev) => ({ ...prev, wsConnected: false }));
  }, []);

  const sendBridgeJson = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const connectDrone = useCallback(
    (mode: DroneMode, host = '192.168.10.1', port = 8889) => {
      activeModeRef.current = mode;

      if (mode === 'simulator') {
        closeBridgeWs();
        simRef.current?.connect();
        return;
      }

      // Real Tello mode: stop browser simulator and connect to local UDP WebSocket bridge
      simRef.current?.disconnect(true);
      closeBridgeWs();

      const configuredWs = import.meta.env.VITE_WS_URL as string | undefined;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl =
        configuredWs && configuredWs.trim() ? configuredWs.trim() : `${protocol}//${window.location.host}/ws`;

      setState((prev) => ({
        ...prev,
        mode: 'tello',
        host,
        port,
        statusMessage: `Connecting to local Tello bridge (${wsUrl})...`,
      }));
      appendLog('info', `Connecting to Tello UDP bridge at ${wsUrl}...`);

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        appendLog('error', `Could not open WebSocket bridge: ${String(err)}`);
        setState((prev) => ({
          ...prev,
          wsConnected: false,
          droneConnected: false,
          statusMessage: 'Local UDP bridge unavailable. Run `npm start` on the laptop joined to Tello Wi-Fi.',
        }));
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        setState((prev) => ({ ...prev, wsConnected: true }));
        ws.send(JSON.stringify({ type: 'connect', mode: 'tello', host, port }));
        pingTimerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
          }
        }, 3000);
      };

      ws.onmessage = (event) => {
        if (activeModeRef.current !== 'tello') return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'status') {
            setState((prev) => ({
              ...prev,
              droneConnected: Boolean(msg.connected),
              mode: 'tello',
              inFlight: Boolean(msg.inFlight),
              host: msg.host ?? prev.host,
              port: msg.port ?? prev.port,
              statusMessage: msg.message ?? prev.statusMessage,
            }));
          } else if (msg.type === 'telemetry') {
            setState((prev) => ({
              ...prev,
              telemetry: msg.data as TelemetryData,
              inFlight: Boolean(msg.data?.inFlight),
              droneConnected: Boolean(msg.data?.connected),
            }));
          } else if (msg.type === 'log') {
            appendLog(msg.level ?? 'info', msg.text ?? '', msg.timestamp);
          } else if (msg.type === 'pong') {
            setState((prev) => ({
              ...prev,
              latencyMs: Math.max(0, Date.now() - Number(msg.clientTime)),
            }));
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        appendLog(
          'error',
          'Could not reach local Tello UDP bridge. For real drone flight, run `npm start` locally while connected to TELLO-XXXXXX Wi-Fi (or use Simulator Mode in any browser).',
        );
      };

      ws.onclose = () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          wsConnected: false,
          droneConnected: false,
          inFlight: false,
          statusMessage: 'Tello UDP bridge disconnected.',
        }));
      };
    },
    [appendLog, closeBridgeWs],
  );

  const disconnectDrone = useCallback(() => {
    if (activeModeRef.current === 'simulator') {
      simRef.current?.disconnect();
    } else {
      sendBridgeJson({ type: 'disconnect' });
      closeBridgeWs();
      setState((prev) => ({
        ...prev,
        droneConnected: false,
        inFlight: false,
        statusMessage: 'Disconnected from Tello',
      }));
    }
  }, [closeBridgeWs, sendBridgeJson]);

  const sendCommand = useCallback(
    (command: string) => {
      if (activeModeRef.current === 'simulator') {
        simRef.current?.sendCommand(command);
      } else {
        sendBridgeJson({ type: 'command', command });
      }
    },
    [sendBridgeJson],
  );

  const sendRc = useCallback(
    (rc: RcVector) => {
      if (activeModeRef.current === 'simulator') {
        simRef.current?.sendRc(rc);
      } else {
        sendBridgeJson({ type: 'rc', ...rc });
      }
    },
    [sendBridgeJson],
  );

  const clearLogs = useCallback(() => {
    setState((prev) => ({ ...prev, logs: [] }));
  }, []);

  return {
    ...state,
    connectDrone,
    disconnectDrone,
    sendCommand,
    sendRc,
    clearLogs,
    appendLog,
  };
}
