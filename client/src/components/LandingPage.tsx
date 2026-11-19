import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Cpu,
  Hand,
  Radio,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { GESTURE_CATALOG } from '../ml/keypointClassifier';
import type { DroneMode } from '../types/tello';
import { GestureSymbol } from './GestureSymbol';

interface LandingPageProps {
  onLaunchCockpit: (initialMode: DroneMode) => void;
}

export function LandingPage({ onLaunchCockpit }: LandingPageProps) {
  const [selectedGestureId, setSelectedGestureId] = useState(0);
  const activeGesture = GESTURE_CATALOG[selectedGestureId] ?? GESTURE_CATALOG[0];

  // Fallback for scroll-driven entry animations when CSS view() is unsupported
  useEffect(() => {
    const supportsViewTimeline = CSS.supports('(animation-timeline: view()) and (animation-range: entry)');
    const wantsMotion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    if (supportsViewTimeline || !wantsMotion) return;

    const elements = document.querySelectorAll<HTMLElement>('.reveal-card');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const ratio = Math.min(1, entry.intersectionRatio * 1.35);
          target.style.opacity = String(0.25 + ratio * 0.75);
          target.style.transform = `translateY(${(1 - ratio) * 18}px)`;
        }
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <div className="container nav-inner">
          <a href="#top" className="brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            <span>AeroHand</span>
            <span className="brand-tag">TELLO WEB</span>
          </a>
          <nav className="nav-links" aria-label="Primary navigation">
            <a href="#how-it-works">Wi-Fi Flow</a>
            <a href="#gestures">8 Gestures</a>
            <a href="#architecture">Architecture</a>
          </nav>
          <div className="nav-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onLaunchCockpit('simulator')}>
              Try Simulator
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onLaunchCockpit('tello')}>
              Launch Cockpit <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section className="hero-section">
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="eyebrow-pill">
                <Sparkles size={14} />
                <span>MediaPipe Hand Tracking + DJI Tello UDP Bridge • 100% Offline-Ready</span>
              </div>
              <h1 className="hero-title">
                Fly your DJI Tello with <span className="text-gradient">your own webcam</span> and hand gestures.
              </h1>
              <p className="hero-subtitle">
                Connect your laptop to your Tello&rsquo;s Wi-Fi, open the local cockpit, and pilot in real time with 8
                trained hand gestures—no gloves, no Python setup, and zero internet required during flight.
              </p>

              <div className="hero-cta-row">
                <button type="button" className="btn btn-primary btn-lg" onClick={() => onLaunchCockpit('tello')}>
                  <Wifi size={18} />
                  Connect Tello &amp; Fly
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  onClick={() => onLaunchCockpit('simulator')}
                >
                  <Zap size={18} />
                  Practice in Simulator
                </button>
              </div>

              <div className="hero-metrics">
                <div className="metric-item">
                  <strong>99.92%</strong>
                  <span>Classifier Fidelity</span>
                </div>
                <div className="metric-item">
                  <strong>8 Gestures</strong>
                  <span>Full 3D + Auto-Land</span>
                </div>
                <div className="metric-item">
                  <strong>0 KB CDN</strong>
                  <span>Works on Tello Wi-Fi</span>
                </div>
              </div>
            </div>

            {/* Interactive Preview Card */}
            <div className="hero-visual">
              <div className="preview-card">
                <div className="preview-header">
                  <span className="status-pill live">
                    <span className="pulse-dot" />
                    ON-DEVICE ML PREVIEW
                  </span>
                  <span className="mono-badge">UDP 192.168.10.1:8889</span>
                </div>

                <div className="preview-stage">
                  <div className="preview-gesture-badge" style={{ borderColor: activeGesture.color }}>
                    <span className="preview-gesture-emoji">
                      <GestureSymbol gestureId={activeGesture.id} fallback={activeGesture.symbol} size={34} />
                    </span>
                    <div>
                      <div className="preview-gesture-name">
                        {activeGesture.label}{' '}
                        <span className="preview-pose-pill">{activeGesture.shortPose}</span>
                      </div>
                      <div className="preview-gesture-action">{activeGesture.action}</div>
                    </div>
                  </div>
                  <p className="preview-hint">{activeGesture.poseHint}</p>

                  <div className="preview-rc-bar">
                    <div className="rc-chip">
                      <span>LR</span>
                      <strong>{activeGesture.baseRc.lr}</strong>
                    </div>
                    <div className="rc-chip">
                      <span>FB</span>
                      <strong>{activeGesture.baseRc.fb}</strong>
                    </div>
                    <div className="rc-chip">
                      <span>UD</span>
                      <strong>{activeGesture.baseRc.ud}</strong>
                    </div>
                    <div className="rc-chip">
                      <span>YAW</span>
                      <strong>{activeGesture.baseRc.yaw}</strong>
                    </div>
                  </div>
                </div>

                <div className="preview-selector" role="tablist" aria-label="Preview flight gestures">
                  {GESTURE_CATALOG.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedGestureId === g.id}
                      className={`gesture-tab ${selectedGestureId === g.id ? 'active' : ''}`}
                      onClick={() => setSelectedGestureId(g.id)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3-Step Wi-Fi Onboarding */}
        <section id="how-it-works" className="section-block">
          <div className="container">
            <div className="section-head">
              <span className="section-kicker">END-TO-END FLIGHT WORKFLOW</span>
              <h2>From Tello Wi-Fi to hands-free flight in 3 steps</h2>
            </div>

            <div className="steps-grid">
              <article className="step-card reveal-card">
                <div className="step-num">01</div>
                <Wifi size={24} className="accent-icon" />
                <h3>Join Tello Wi-Fi</h3>
                <p>
                  Power on your DJI Tello and connect your computer to <code>TELLO-XXXXXX</code>. Because all MediaPipe
                  WASM and neural weights are self-hosted locally, offline Wi-Fi works seamlessly.
                </p>
              </article>

              <article className="step-card reveal-card">
                <div className="step-num">02</div>
                <Camera size={24} className="accent-icon" />
                <h3>Enable Your Webcam</h3>
                <p>
                  Open the Flight Cockpit and allow browser camera access. MediaPipe HandLandmarker tracks 21 3D hand
                  keypoints at up to 60 FPS right inside your browser tab.
                </p>
              </article>

              <article className="step-card reveal-card">
                <div className="step-num">03</div>
                <Hand size={24} className="accent-icon" />
                <h3>Take Off &amp; Command</h3>
                <p>
                  Press <code>Space</code> to take off, switch to Gesture Mode (<code>G</code>), and steer with your
                  hand. A multi-frame stability buffer filters jitter before sending UDP <code>rc</code> packets.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* 8 Gestures Grid */}
        <section id="gestures" className="section-block section-alt">
          <div className="container">
            <div className="section-head">
              <span className="section-kicker">TRAINED KEYPOINT CLASSIFIER</span>
              <h2>All 8 original Tello gestures, ported with 99.92% fidelity</h2>
              <p className="section-sub">
                Extracted directly from the original <code>keypoint_classifier.tflite</code> weights—running in pure
                TypeScript in under 0.1ms per frame.
              </p>
            </div>

            <div className="gestures-grid">
              {GESTURE_CATALOG.map((g) => (
                <article key={g.id} className="gesture-card reveal-card">
                  <div className="gesture-card-top">
                    <span className="gesture-card-symbol">
                      <GestureSymbol gestureId={g.id} fallback={g.symbol} size={30} />
                    </span>
                    <span className="gesture-rc-tag">
                      {g.isLandCommand ? 'CMD: land' : `RC ${g.baseRc.lr} ${g.baseRc.fb} ${g.baseRc.ud} 0`}
                    </span>
                  </div>
                  <h3>
                    {g.label} <span className="gesture-pose-inline">• {g.shortPose}</span>
                  </h3>
                  <p className="gesture-card-action" style={{ color: g.color }}>
                    {g.action}
                  </p>
                  <p className="gesture-card-hint">{g.poseHint}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture Highlights */}
        <section id="architecture" className="section-block">
          <div className="container">
            <div className="section-head">
              <span className="section-kicker">ENGINEERED FOR REAL DRONE SAFETY</span>
              <h2>Why a browser + local UDP bridge beats fragile scripts</h2>
            </div>

            <div className="arch-grid">
              <article className="arch-card reveal-card">
                <WifiOff size={22} className="accent-icon" />
                <h3>100% Offline-First Assets</h3>
                <p>
                  MediaPipe WASM, <code>hand_landmarker.task</code>, and MLP weights are served directly from localhost—
                  zero external CDN calls when connected to Tello Wi-Fi.
                </p>
              </article>

              <article className="arch-card reveal-card">
                <Radio size={22} className="accent-icon" />
                <h3>Real-Time UDP 8889 / 8890 Bridge</h3>
                <p>
                  Node.js WebSocket server queues SDK commands (<code>takeoff</code>, <code>land</code>,{' '}
                  <code>flip</code>), streams 10 Hz telemetry, and sends 10s keep-alive pulses.
                </p>
              </article>

              <article className="arch-card reveal-card">
                <ShieldCheck size={22} className="accent-icon" />
                <h3>Fail-Safe Hover Watchdog</h3>
                <p>
                  If your hand leaves the frame, the browser closes, or you hit <code>Esc</code>, the bridge immediately
                  zeros RC velocity (<code>rc 0 0 0 0</code>) or triggers emergency cutoff.
                </p>
              </article>

              <article className="arch-card reveal-card">
                <Cpu size={22} className="accent-icon" />
                <h3>Built-In Physics Simulator</h3>
                <p>
                  Test your webcam gestures, buffer sensitivity, and keyboard overrides against a live virtual Tello
                  before ever spinning up real propellers.
                </p>
              </article>
            </div>

            <div className="cta-banner reveal-card">
              <div>
                <h2>Ready to test your webcam hand tracking?</h2>
                <p>Start in Simulator Mode right now, or connect to your Tello Wi-Fi for live flight.</p>
              </div>
              <div className="hero-cta-row">
                <button type="button" className="btn btn-primary btn-lg" onClick={() => onLaunchCockpit('simulator')}>
                  Launch Flight Cockpit <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="container footer-inner">
          <span>AeroHand • Web Evolution of tello-gesture-control</span>
          <span>DJI Tello SDK UDP 8889 • MediaPipe HandLandmarker</span>
        </div>
      </footer>
    </div>
  );
}
