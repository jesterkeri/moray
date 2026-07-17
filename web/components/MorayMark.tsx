export function MorayMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="0"
        fill="var(--surface-2)"
        stroke="var(--border-strong)"
        strokeWidth="1"
      />
      {/* a moray's protective S-curve, coiled around what it guards */}
      <path
        d="M9.5 21.5c0-3.8 2.6-4.9 5.7-6 3.1-1.1 5.8-2.2 5.8-6.2"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="21.5" r="2.1" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span
      style={{
        fontWeight: 700,
        fontSize: 20,
        letterSpacing: '-0.02em',
        color: 'var(--text)',
      }}
    >
      Moray
    </span>
  );
}
