import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { NormalizedPoint } from './keypointClassifier';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],// Ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // Little + Palm
];

export class OfflineHandTracker {
  private landmarker: HandLandmarker | null = null;

  public async init(minConfidence = 0.65): Promise<void> {
    if (this.landmarker) return;

    // 100% locally served (and PWA-cached) WASM + model so it works offline on Tello Wi-Fi
    const vision = await FilesetResolver.forVisionTasks('/wasm');
    const create = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: minConfidence,
        minHandPresenceConfidence: minConfidence,
        minTrackingConfidence: 0.5,
      });

    try {
      this.landmarker = await create('GPU');
    } catch {
      // Mobile Safari / older Android WebGL fallback to CPU WASM
      this.landmarker = await create('CPU');
    }
  }

  public detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    return this.landmarker.detectForVideo(video, timestampMs);
  }

  public close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

export function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedPoint[],
  width: number,
  height: number,
  mirrored: boolean,
  label: string,
  confidence: number,
  accentColor: string,
): void {
  if (landmarks.length !== 21) return;

  const pts = landmarks.map((lm) => ({
    x: (mirrored ? 1 - lm.x : lm.x) * width,
    y: lm.y * height,
  }));

  // Bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 16;
  const bx = Math.max(4, minX - pad);
  const by = Math.max(28, minY - pad);
  const bw = Math.min(width - bx - 4, maxX - minX + pad * 2);
  const bh = Math.min(height - by - 4, maxY - minY + pad * 2);

  // Draw HUD bracket box
  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([]);

  // Label pill above box
  const text = `${label.toUpperCase()}  ${Math.round(confidence * 100)}%`;
  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  const textWidth = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
  ctx.fillRect(bx, by - 26, textWidth + 16, 22);
  ctx.fillStyle = accentColor;
  ctx.fillText(text, bx + 8, by - 10);

  // Skeleton lines
  ctx.lineCap = 'round';
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Keypoints
  const tipIndices = new Set([4, 8, 12, 16, 20]);
  for (let i = 0; i < pts.length; i++) {
    const r = tipIndices.has(i) ? 5.5 : 3.5;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.fillStyle = tipIndices.has(i) ? accentColor : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#090d16';
    ctx.stroke();
  }

  ctx.restore();
}
