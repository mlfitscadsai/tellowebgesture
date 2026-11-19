import type { RcVector, TelemetryData } from '../types/tello';

interface DroneHudVisualizerProps {
  telemetry: TelemetryData;
  activeRc: RcVector;
}

export function DroneHudVisualizer({ telemetry, activeRc }: DroneHudVisualizerProps) {
  // Map posX/posY (-250..250 cm) onto a 140x140 radar pad
  const padSize = 140;
  const center = padSize / 2;
  const dx = center + (telemetry.posX / 250) * (center - 16);
  const dy = center - (telemetry.posY / 250) * (center - 16);
  const altPct = Math.max(0, Math.min(100, (telemetry.height / 300) * 100));

  return (
    <div className="hud-visualizer">
      <div className="hud-card">
        <div className="hud-card-label">Flight Radar (Top-Down)</div>
        <svg viewBox={`0 0 ${padSize} ${padSize}`} className="radar-svg" aria-label="Drone position radar">
          <circle cx={center} cy={center} r={58} className="radar-ring" />
          <circle cx={center} cy={center} r={34} className="radar-ring" />
          <line x1={center} y1={8} x2={center} y2={padSize - 8} className="radar-axis" />
          <line x1={8} y1={center} x2={padSize - 8} y2={center} className="radar-axis" />

          {/* Drone marker rotated by yaw */}
          <g transform={`translate(${dx}, ${dy}) rotate(${telemetry.yaw})`}>
            <polygon points="0,-10 7,8 0,4 -7,8" className={telemetry.inFlight ? 'drone-marker flying' : 'drone-marker'} />
            <circle cx={0} cy={0} r={telemetry.inFlight ? 14 : 6} className={telemetry.inFlight ? 'drone-halo flying' : 'drone-halo'} />
          </g>
        </svg>
        <div className="hud-coords">
          <span>X: {telemetry.posX}cm</span>
          <span>Y: {telemetry.posY}cm</span>
          <span>YAW: {telemetry.yaw}°</span>
        </div>
      </div>

      <div className="hud-card">
        <div className="hud-card-label">Attitude &amp; Altitude</div>
        <div className="attitude-wrap">
          <div className="horizon-box" aria-label="Artificial horizon">
            <div
              className="horizon-sky"
              style={{
                transform: `rotate(${-telemetry.roll}deg) translateY(${telemetry.pitch * 1.4}px)`,
              }}
            >
              <div className="horizon-line" />
            </div>
            <div className="horizon-reticle" />
          </div>

          <div className="alt-meter" aria-label={`Altitude ${telemetry.height} cm`}>
            <div className="alt-bar-track">
              <div className="alt-bar-fill" style={{ height: `${altPct}%` }} />
            </div>
            <span className="alt-val">{telemetry.height}cm</span>
          </div>
        </div>

        <div className="rc-mini-grid">
          <div>
            <span>LR</span>
            <strong>{activeRc.lr}</strong>
          </div>
          <div>
            <span>FB</span>
            <strong>{activeRc.fb}</strong>
          </div>
          <div>
            <span>UD</span>
            <strong>{activeRc.ud}</strong>
          </div>
          <div>
            <span>YAW</span>
            <strong>{activeRc.yaw}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
