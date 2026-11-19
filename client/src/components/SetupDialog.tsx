import { useEffect, useRef, useState } from 'react';
import { Wifi, CheckCircle2, AlertTriangle, Radio, X } from 'lucide-react';

interface SetupDialogProps {
  open: boolean;
  host: string;
  port: number;
  onClose: () => void;
  onConnectTello: (host: string, port: number) => void;
}

export function SetupDialog({ open, host, port, onClose, onConnectTello }: SetupDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [customHost, setCustomHost] = useState(host);
  const [customPort, setCustomPort] = useState(String(port));
  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; latencyMs: number; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setProbeResult(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const runProbe = async () => {
    setTesting(true);
    setProbeResult(null);
    try {
      const apiBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/api/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: customHost.trim() || '192.168.10.1',
          port: Number.parseInt(customPort, 10) || 8889,
        }),
      });
      const data = (await res.json()) as { ok: boolean; latencyMs: number; message: string };
      setProbeResult(data);
    } catch (err) {
      setProbeResult({
        ok: false,
        latencyMs: 0,
        message: `Bridge unreachable: ${String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog modal-dialog-lg"
      aria-labelledby="setup-dialog-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title-row">
            <Wifi size={20} className="accent-icon" />
            <h2 id="setup-dialog-title" className="modal-title">
              DJI Tello Wi-Fi Connection & Diagnostics
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close setup dialog"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} />
          </button>
        </div>

        <ol className="setup-steps">
          <li>
            <strong>Power on your DJI Tello</strong> — wait until the front LED blinks amber/yellow.
          </li>
          <li>
            <strong>Join the Tello Wi-Fi network</strong> on this computer (<code>TELLO-XXXXXX</code>). Internet will
            disconnect — that is expected! This web app &amp; MediaPipe ML run <strong>100% offline</strong>.
          </li>
          <li>
            <strong>Verify UDP reachability</strong> below, then click <em>Connect to Tello</em>.
          </li>
        </ol>

        <div className="setup-form-grid">
          <label className="field-label">
            <span>Tello IP Address</span>
            <input
              type="text"
              className="text-input"
              value={customHost}
              onChange={(e) => setCustomHost(e.target.value)}
              placeholder="192.168.10.1"
            />
          </label>
          <label className="field-label">
            <span>SDK UDP Port</span>
            <input
              type="number"
              className="text-input"
              value={customPort}
              onChange={(e) => setCustomPort(e.target.value)}
              placeholder="8889"
            />
          </label>
        </div>

        {probeResult && (
          <div
            className={`probe-banner ${probeResult.ok ? 'probe-ok' : 'probe-err'}`}
            role="status"
            aria-live="polite"
          >
            {probeResult.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{probeResult.message}</span>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={runProbe} disabled={testing}>
            <Radio size={15} />
            {testing ? 'Probing UDP 8889...' : 'Test UDP Connection'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onConnectTello(customHost.trim() || '192.168.10.1', Number.parseInt(customPort, 10) || 8889);
              dialogRef.current?.close();
            }}
          >
            Connect to Tello
          </button>
        </div>
      </div>
    </dialog>
  );
}
