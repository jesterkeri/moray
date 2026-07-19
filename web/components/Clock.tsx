'use client';

/**
 * The Moray time-lock clock — the landing's signature dial, reused wherever the
 * app shows a live countdown (a clearing/recall window, a pending config change,
 * an inheritance veto period). Give it seconds remaining + the total window and
 * it renders a depleting arc + sweeping hand + readout.
 */
export function Clock({
  secondsLeft,
  totalSeconds,
  caption,
  tone = 'accent',
  size = 168,
}: {
  secondsLeft: number;
  totalSeconds: number;
  caption?: string;
  tone?: 'accent' | 'danger' | 'success';
  size?: number;
}) {
  const s = Math.max(0, Math.floor(secondsLeft));
  const fraction = totalSeconds > 0 ? Math.max(0, Math.min(1, s / totalSeconds)) : 0;

  const readout = formatReadout(s);
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--accent)';

  const R = 68;
  const CIRC = 2 * Math.PI * R;
  const dashoffset = CIRC * (1 - fraction);
  const handAngle = 360 * (1 - fraction);

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const rad = (i * 6 * Math.PI) / 180;
    const outer = 80;
    const inner = major ? 70 : 74.5;
    return {
      x1: 100 + outer * Math.sin(rad),
      y1: 100 - outer * Math.cos(rad),
      x2: 100 + inner * Math.sin(rad),
      y2: 100 - inner * Math.cos(rad),
      major,
    };
  });

  return (
    <div className="dial-wrap">
      <svg
        className="dial"
        width={size}
        height={size}
        viewBox="0 0 200 200"
        role="img"
        aria-label={`${caption ?? 'Time remaining'}: ${readout}`}
      >
        <circle cx="100" cy="100" r="94" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="86" fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />

        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.major ? color : 'var(--border-strong)'}
            strokeWidth={t.major ? 1.6 : 1}
            strokeLinecap="round"
            opacity={t.major ? 0.9 : 0.55}
          />
        ))}

        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth="3" opacity="0.5" />
        <circle
          className="dial-arc"
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 100 100)"
        />

        <g className="dial-hand" style={{ transform: `rotate(${handAngle}deg)` }}>
          <line x1="100" y1="106" x2="100" y2="36" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="100" cy="100" r="4.5" fill={color} />
          <circle cx="100" cy="100" r="2" fill="var(--surface)" />
        </g>

        <text className="dial-readout" x="100" y="99" textAnchor="middle" fontSize={readout.length > 5 ? 26 : 30}>
          {readout}
        </text>
        {caption && (
          <text className="dial-caption" x="100" y="122" textAnchor="middle">
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}

function formatReadout(s: number): string {
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d}d ${String(h).padStart(2, '0')}h`;
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
