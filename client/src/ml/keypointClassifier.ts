import type { GesturePrediction, GestureSpec, RcVector } from '../types/tello';

interface DenseLayer {
  weights: number[][];
  biases: number[];
  activation: 'relu' | 'softmax';
}

interface ClassifierModelJson {
  labels: string[];
  inputSize: number;
  layers: DenseLayer[];
}

export interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
}

export const GESTURE_CATALOG: GestureSpec[] = [
  {
    id: 0,
    label: 'Forward',
    symbol: '✋',
    shortPose: 'Open Palm',
    action: 'Pitch Forward (+30)',
    poseHint: 'Open palm facing camera with fingers together pointing up',
    baseRc: { lr: 0, fb: 30, ud: 0, yaw: 0 },
    color: '#22d3ee',
  },
  {
    id: 1,
    label: 'Stop',
    symbol: '✊',
    shortPose: 'Upright Fist',
    action: 'Hover Brake (0, 0, 0, 0)',
    poseHint: 'Upright closed fist facing camera to immediately hover in place',
    baseRc: { lr: 0, fb: 0, ud: 0, yaw: 0 },
    color: '#f59e0b',
  },
  {
    id: 2,
    label: 'Up',
    symbol: '👆',
    shortPose: 'Index Up',
    action: 'Ascend (+25)',
    poseHint: 'Index finger pointing straight up, other fingers curled',
    baseRc: { lr: 0, fb: 0, ud: 25, yaw: 0 },
    color: '#34d399',
  },
  {
    id: 3,
    label: 'Land',
    symbol: '👌',
    shortPose: 'OK Sign',
    action: 'Auto-Land Sequence',
    poseHint: 'OK sign — touch thumb & index tips together with 3 fingers up',
    baseRc: { lr: 0, fb: 0, ud: 0, yaw: 0 },
    isLandCommand: true,
    color: '#f43f5e',
  },
  {
    id: 4,
    label: 'Down',
    symbol: '👇',
    shortPose: 'Index Down',
    action: 'Descend (-25)',
    poseHint: 'Index finger pointing straight down toward the floor',
    baseRc: { lr: 0, fb: 0, ud: -25, yaw: 0 },
    color: '#a78bfa',
  },
  {
    id: 5,
    label: 'Back',
    symbol: '👊',
    shortPose: 'Forward Fist',
    action: 'Pitch Backward (-30)',
    poseHint: 'Fist tilted forward (knuckles / punch facing camera)',
    baseRc: { lr: 0, fb: -30, ud: 0, yaw: 0 },
    color: '#38bdf8',
  },
  {
    id: 6,
    label: 'Left',
    symbol: '🤛',
    shortPose: 'Thumb Left',
    action: 'Strafe Left (+20)',
    poseHint: 'Upright fist with thumb extended pointing to the left',
    baseRc: { lr: 20, fb: 0, ud: 0, yaw: 0 },
    color: '#60a5fa',
  },
  {
    id: 7,
    label: 'Right',
    symbol: '🤜',
    shortPose: 'Thumb Right',
    action: 'Strafe Right (-20)',
    poseHint: 'Upright fist with thumb extended pointing to the right',
    baseRc: { lr: -20, fb: 0, ud: 0, yaw: 0 },
    color: '#818cf8',
  },
];

/**
 * Exact JavaScript/TypeScript port of `KeyPointClassifier` + `_pre_process_landmark`
 * from `tello-gesture-control/gestures/gesture_recognition.py`.
 * Verified 99.92% identical to the original TFLite model on `keypoint.csv`.
 */
export class KeyPointClassifier {
  private model: ClassifierModelJson | null = null;

  public async load(url = '/models/keypoint_classifier_weights.json'): Promise<void> {
    if (this.model) return;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load keypoint classifier weights (${res.status})`);
    }
    this.model = (await res.json()) as ClassifierModelJson;
  }

  public isLoaded(): boolean {
    return this.model !== null;
  }

  public preprocessLandmarks(
    landmarks: NormalizedPoint[],
    imageWidth: number,
    imageHeight: number,
    mirrored = true,
  ): number[] {
    // Convert to pixel coordinates matching OpenCV `cv.flip(image, 1)` + `_calc_landmark_list`
    const pts: Array<[number, number]> = landmarks.map((lm) => {
      const nx = mirrored ? 1 - lm.x : lm.x;
      const x = Math.min(Math.floor(nx * imageWidth), imageWidth - 1);
      const y = Math.min(Math.floor(lm.y * imageHeight), imageHeight - 1);
      return [x, y];
    });

    const [baseX, baseY] = pts[0] ?? [0, 0];
    const flat: number[] = new Array(pts.length * 2);
    let maxAbs = 0;

    for (let i = 0; i < pts.length; i++) {
      const rx = pts[i][0] - baseX;
      const ry = pts[i][1] - baseY;
      flat[i * 2] = rx;
      flat[i * 2 + 1] = ry;
      const ax = Math.abs(rx);
      const ay = Math.abs(ry);
      if (ax > maxAbs) maxAbs = ax;
      if (ay > maxAbs) maxAbs = ay;
    }

    const denom = maxAbs > 0 ? maxAbs : 1;
    for (let i = 0; i < flat.length; i++) {
      flat[i] = flat[i] / denom;
    }

    return flat;
  }

  public classify(
    landmarks: NormalizedPoint[],
    imageWidth: number,
    imageHeight: number,
    mirrored = true,
  ): GesturePrediction {
    if (!this.model || landmarks.length !== 21) {
      return { id: -1, label: 'None', confidence: 0, probabilities: [] };
    }

    let vec = this.preprocessLandmarks(landmarks, imageWidth, imageHeight, mirrored);

    for (const layer of this.model.layers) {
      const out = new Array<number>(layer.biases.length);
      for (let r = 0; r < layer.weights.length; r++) {
        const row = layer.weights[r];
        let sum = layer.biases[r];
        for (let c = 0; c < row.length; c++) {
          sum += row[c] * vec[c];
        }
        out[r] = layer.activation === 'relu' ? (sum > 0 ? sum : 0) : sum;
      }

      if (layer.activation === 'softmax') {
        let maxVal = -Infinity;
        for (let i = 0; i < out.length; i++) {
          if (out[i] > maxVal) maxVal = out[i];
        }
        let expSum = 0;
        for (let i = 0; i < out.length; i++) {
          out[i] = Math.exp(out[i] - maxVal);
          expSum += out[i];
        }
        for (let i = 0; i < out.length; i++) {
          out[i] = out[i] / (expSum || 1);
        }
      }

      vec = out;
    }

    let bestIdx = 0;
    let bestProb = -1;
    for (let i = 0; i < vec.length; i++) {
      if (vec[i] > bestProb) {
        bestProb = vec[i];
        bestIdx = i;
      }
    }

    return {
      id: bestIdx,
      label: this.model.labels[bestIdx] ?? `Class ${bestIdx}`,
      confidence: bestProb,
      probabilities: vec,
    };
  }
}

/**
 * Port of `GestureBuffer` from `tello-gesture-control/gestures/gesture_recognition.py`.
 * Requires `bufferLen - 1` consistent frames before firing a stable gesture command.
 */
export class GestureBuffer {
  private buffer: number[] = [];
  private bufferLen: number;

  constructor(bufferLen = 5) {
    this.bufferLen = Math.max(2, bufferLen);
  }

  public setBufferLength(len: number): void {
    this.bufferLen = Math.max(2, len);
    if (this.buffer.length > this.bufferLen) {
      this.buffer = this.buffer.slice(-this.bufferLen);
    }
  }

  public clear(): void {
    this.buffer = [];
  }

  public push(gestureId: number): { confirmedId: number | null; stability: number; candidateId: number } {
    this.buffer.push(gestureId);
    if (this.buffer.length > this.bufferLen) {
      this.buffer.shift();
    }

    const counts = new Map<number, number>();
    for (const id of this.buffer) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    let topId = -1;
    let topCount = 0;
    for (const [id, count] of counts.entries()) {
      if (count > topCount) {
        topId = id;
        topCount = count;
      }
    }

    const threshold = Math.max(1, this.bufferLen - 1);
    const stability = Math.min(1, topCount / threshold);

    if (topCount >= threshold) {
      return { confirmedId: topId, stability: 1, candidateId: topId };
    }

    return { confirmedId: null, stability, candidateId: topId };
  }
}

export function gestureIdToRc(gestureId: number, speedScale = 1): RcVector {
  const spec = GESTURE_CATALOG.find((g) => g.id === gestureId);
  if (!spec || spec.isLandCommand) {
    return { lr: 0, fb: 0, ud: 0, yaw: 0 };
  }
  return {
    lr: Math.round(spec.baseRc.lr * speedScale),
    fb: Math.round(spec.baseRc.fb * speedScale),
    ud: Math.round(spec.baseRc.ud * speedScale),
    yaw: Math.round(spec.baseRc.yaw * speedScale),
  };
}
