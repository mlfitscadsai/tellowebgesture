interface GestureSymbolProps {
  gestureId: number;
  fallback: string;
  size?: number;
}

/**
 * Renders the exact official hand gesture symbol matching `tello-gesture-control`.
 * Uses custom inline SVGs for Left (6) and Right (7) — fist with thumb pointing
 * left/right — since Unicode lacks a dedicated fist-with-side-thumb emoji.
 */
export function GestureSymbol({ gestureId, fallback, size = 28 }: GestureSymbolProps) {
  if (gestureId === 6 || gestureId === 7) {
    const flipX = gestureId === 7;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        aria-hidden="true"
        style={{
          display: 'inline-block',
          verticalAlign: 'middle',
          transform: flipX ? 'scaleX(-1)' : undefined,
        }}
      >
        {/* Extended thumb pointing left (mirrored for right) */}
        <path
          d="M14 19.5 L6.2 18.2 C4.2 17.9 3 19.3 3.4 21.1 C3.7 22.7 5.2 23.6 7.4 24.1 L13.5 25.5 Z"
          fill="#ffcb4c"
          stroke="#c9851e"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* Palm / fist base */}
        <rect
          x="13"
          y="13"
          width="17"
          height="16"
          rx="5.5"
          fill="#ffcb4c"
          stroke="#c9851e"
          strokeWidth="1.4"
        />
        {/* Four curled fingers across the top of the fist */}
        <rect x="13.8" y="10.2" width="3.9" height="8.5" rx="1.9" fill="#ffd76a" stroke="#c9851e" strokeWidth="1.2" />
        <rect x="17.8" y="9.4" width="3.9" height="9.2" rx="1.9" fill="#ffd76a" stroke="#c9851e" strokeWidth="1.2" />
        <rect x="21.8" y="9.8" width="3.9" height="8.8" rx="1.9" fill="#ffd76a" stroke="#c9851e" strokeWidth="1.2" />
        <rect x="25.6" y="11" width="3.6" height="7.8" rx="1.8" fill="#ffd76a" stroke="#c9851e" strokeWidth="1.2" />
      </svg>
    );
  }

  return (
    <span aria-hidden="true" style={{ fontSize: `${size}px`, lineHeight: 1.1, display: 'inline-block' }}>
      {fallback}
    </span>
  );
}
