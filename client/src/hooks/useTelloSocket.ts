import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useTelloSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(1);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<SocketState>({
    wsConnected: false,
    droneConnected: false,
    mode: 'simulator',
    inFlight: false,
    host: '192.168.10.1',
    port: 8889,
    statusMessage: 'Connecting to local Tello bridge...',
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

  const sendJson = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    let active = true;

    const connectWs = () => {
      if (!active) return;
      const configuredWs = import.meta.env.VITE_WS_URL as string | undefined;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = configuredWs && configuredWs.trim() ? configuredWs.trim() : `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setState((prev) => ({
          ...prev,
          wsConnected: true,
          statusMessage: 'Bridge online. Ready to connect to Tello Wi-Fi or Simulator.',
        }));
        appendLog('info', 'Connected to local WebSocket bridge (/ws)');

        pingTimerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
          }
        }, 3000);
      };

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'status') {
            setState((prev) => ({
              ...prev,
              droneConnected: Boolean(msg.connected),
              mode: msg.mode ?? prev.mode,
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

      ws.onclose = () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (!active) return;
        setState((prev) => ({
          ...prev,
          wsConnected: false,
          statusMessage: 'Bridge disconnected — retrying...',
        }));
        reconnectTimerRef.current = window.setTimeout(connectWs, 2000);
      };
    };

    connectWs();

    return () => {
      active = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      wsRef.current?.close();
    };
  }, [appendLog]);

  const connectDrone = useCallback(
    (mode: DroneMode, host = '192.168.10.1', port = 8889) => {
      sendJson({ type: 'connect', mode, host, port });
    },
    [sendJson],
  );

  const disconnectDrone = useCallback(() => {
    sendJson({ type: 'disconnect' });
  }, [sendJson]);

  const sendCommand = useCallback(
    (command: string) => {
      sendJson({ type: 'command', command });
    },
    [sendJson],
  );

  const sendRc = useCallback(
    (rc: RcVector) => {
      sendJson({ type: 'rc', ...rc });
    },
    [sendJson],
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
