'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { MORAY_ADDRESS, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';

const HOLD_SECONDS = 60;

export function Landing() {
  const { login, ready } = usePrivy();

  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="landing-copy">
          <div className="landing-eyebrow">
            <span className="idx">001</span>
            <span className="rule" />
            <span>The self-custodial safe</span>
          </div>
          <h1>
            Know who you're <span className="accent-word">paying,</span> before you send.
          </h1>
          <p className="lede">
            Before a payment leaves, Moray checks who you are sending to: a saved
            beneficiary, a brand-new address, a contract, an empty wallet, or a
            lookalike of someone you trust. Anyone unknown is held in a window you
            can recall, so a scam or a typo never leaves for good.
          </p>
          <div className="landing-cta">
            <button className="bracket-btn primary" disabled={!ready} onClick={() => login()}>
              Enter your safe
            </button>
            <a
              className="bracket-btn"
              href="https://github.com/jesterkeri/moray"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the contract
            </a>
          </div>
        </div>

        <div className="hero-demo">
          <TimeLockDemo />
        </div>
      </div>

      <SpecPlate />

      <section className="ledger">
        <div className="ledger-head">
          <h2 className="ledger-lead">
            Three ways people lose crypto.
            <br />
            Three locks, all on-chain.
          </h2>
          <div className="ledger-legend">
            <span className="chip dark" />
            Threat
            <span className="chip gold" />
            What Moray does
          </div>
        </div>

        <div className="threat-grid">
          {THREATS.map((t) => (
            <article className="tile threat" key={`${t.n}-l`}>
              <span className="tile-label">Threat · {t.n}</span>
              <h3>{t.loss}</h3>
              <p>{t.lossDesc}</p>
            </article>
          ))}
          {THREATS.map((t) => (
            <article className="tile answer" key={`${t.n}-f`}>
              <span className="tile-label">Moray</span>
              <h3>{t.fix}</h3>
              <p>{t.fixDesc}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const THREATS = [
  {
    n: '01',
    loss: 'A wrong or scam send',
    lossDesc: "One typo, one poisoned address, and it's gone the instant you hit send.",
    fix: 'It checks the address first',
    fixDesc:
      "Moray flags new, unused, contract or lookalike addresses, then holds the payment in a window you can recall.",
  },
  {
    n: '02',
    loss: 'A stolen key',
    lossDesc: 'Whoever holds your key holds your funds, and can drain the balance in one transaction.',
    fix: 'A stolen key stays survivable',
    fixDesc:
      'Nothing is unhackable, so instant cash-out is capped low, larger moves are delayed and freezable, and a recovery contact can sweep to your cold wallet.',
  },
  {
    n: '03',
    loss: 'Lost access, for good',
    lossDesc: 'Lose the key with no backup and the funds are frozen forever. No one can reach them.',
    fix: 'An heir you can veto',
    fixDesc: 'Name an heir. If you go silent they inherit after a delay you cancel simply by using your vault.',
  },
];

/** A machine nameplate: real, on-chain identity set like a spec plate. */
function SpecPlate() {
  const explorer = monadTestnet.blockExplorers?.default.url;
  return (
    <div className="spec-plate">
      <div className="spec-cell">
        <span className="spec-val">Moray</span>
        <span className="spec-key">Safe · v1</span>
      </div>
      <div className="spec-cell">
        <span className="spec-val">Monad testnet · 10143</span>
        <span className="spec-key">Network</span>
      </div>
      <div className="spec-cell">
        {MORAY_ADDRESS && explorer ? (
          <a
            className="spec-val link"
            href={`${explorer}/address/${MORAY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortAddress(MORAY_ADDRESS)}
          </a>
        ) : (
          <span className="spec-val">not deployed</span>
        )}
        <span className="spec-key">Contract</span>
      </div>
      <div className="spec-cell">
        <span className="spec-val">None</span>
        <span className="spec-key">Owner / admin</span>
      </div>
    </div>
  );
}

type DemoStatus = 'holding' | 'recalled' | 'cleared';

/**
 * A self-contained illustration of the new-payee hold: a send clears through a
 * time-lock you can recall. Nothing here touches the chain. It exists to show
 * the mechanism, not to represent anyone's real balance.
 */
function TimeLockDemo() {
  const [status, setStatus] = useState<DemoStatus>('holding');
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (status !== 'holding') return;
    timer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timer.current) clearInterval(timer.current);
          setStatus('cleared');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [status]);

  const recall = () => {
    if (timer.current) clearInterval(timer.current);
    setStatus('recalled');
  };
  const replay = () => {
    setSecondsLeft(HOLD_SECONDS);
    setStatus('holding');
  };

  const fraction = secondsLeft / HOLD_SECONDS;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const readout = status === 'recalled' ? '--:--' : `${mm}:${ss}`;
  const caption =
    status === 'holding' ? 'Clearing' : status === 'recalled' ? 'Recalled' : 'Cleared';

  return (
    <div className="vault-panel">
      <svg className="vault-rings" viewBox="0 0 340 340" aria-hidden="true">
        {[168, 132, 96, 60].map((r) => (
          <circle key={r} cx="170" cy="170" r={r} fill="none" stroke="currentColor" strokeWidth="1" />
        ))}
        {Array.from({ length: 72 }, (_, i) => {
          const rad = (i * 5 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={170 + 168 * Math.sin(rad)}
              y1={170 - 168 * Math.cos(rad)}
              x2={170 + 160 * Math.sin(rad)}
              y2={170 - 160 * Math.cos(rad)}
              stroke="currentColor"
              strokeWidth="1"
            />
          );
        })}
      </svg>

      <div className="vault-plate">
        <span className="vault-plate-label">Recipient check</span>
        <span className="vault-tag">Demo</span>
      </div>

      <div className="vault-payee">
        <span className="addr">0x8f2c…4a1b</span>
        <span className="amt">0.50 MON</span>
      </div>

      <div className="vault-scan">
        <div className="scan-row">
          <span className="scan-label">First seen</span>
          <span className="scan-value">Never</span>
        </div>
        <div className="scan-row">
          <span className="scan-label">On-chain history</span>
          <span className="scan-value">No transactions</span>
        </div>
        <div className="scan-row">
          <span className="scan-label">Verdict</span>
          <span className="scan-value flag">New · treated as risky</span>
        </div>
      </div>

      <Dial fraction={fraction} readout={readout} caption={caption} status={status} />

      <div className="vault-action">
        {status === 'holding' ? (
          <>
            <button className="btn btn-secondary" onClick={recall}>
              Recall
            </button>
            <span className="vault-status">
              Held for review. Recall it before the clock runs out.
            </span>
          </>
        ) : status === 'recalled' ? (
          <>
            <button className="btn btn-secondary" onClick={replay}>
              Replay
            </button>
            <span className="vault-status recalled">
              <strong>Recalled.</strong> 0.50 MON back in your safe.
            </span>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={replay}>
              Replay
            </button>
            <span className="vault-status">
              <strong>Cleared.</strong> You let the hold finish, so it went through.
            </span>
          </>
        )}
      </div>

      <p className="vault-note">
        An illustration of the hold, not a live transaction. In the app the window
        sizes itself to how risky the recipient looks.
      </p>
    </div>
  );
}

function Dial({
  fraction,
  readout,
  caption,
  status,
}: {
  fraction: number;
  readout: string;
  caption: string;
  status: DemoStatus;
}) {
  const R = 68;
  const CIRC = 2 * Math.PI * R;
  const remaining = status === 'recalled' ? 0 : fraction;
  const dashoffset = CIRC * (1 - remaining);
  const handAngle = 360 * (1 - remaining);

  // 60 ticks; majors every 5.
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

  const arcColor = status === 'recalled' ? 'var(--accent)' : status === 'cleared' ? 'var(--success)' : 'var(--accent)';

  return (
    <div className="dial-wrap">
      <svg className="dial" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`${caption}, ${readout}`}>
        {/* bezel + face */}
        <circle cx="100" cy="100" r="94" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="86" fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />

        {/* ticks */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.major ? 'var(--accent)' : 'var(--border-strong)'}
            strokeWidth={t.major ? 1.6 : 1}
            strokeLinecap="round"
            opacity={t.major ? 0.9 : 0.55}
          />
        ))}

        {/* depleting track + arc */}
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth="3" opacity="0.5" />
        <circle
          className="dial-arc"
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke={arcColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 100 100)"
        />

        {/* sweeping hand */}
        {status !== 'recalled' && (
          <g className="dial-hand" style={{ transform: `rotate(${handAngle}deg)` }}>
            <line x1="100" y1="106" x2="100" y2="36" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="100" cy="100" r="4.5" fill="var(--accent)" />
            <circle cx="100" cy="100" r="2" fill="var(--surface)" />
          </g>
        )}
        {status === 'recalled' && <circle cx="100" cy="100" r="4.5" fill="var(--accent)" />}

        {/* readout */}
        <text className="dial-readout" x="100" y="99" textAnchor="middle" fontSize="30">
          {readout}
        </text>
        <text className="dial-caption" x="100" y="122" textAnchor="middle">
          {caption}
        </text>
      </svg>
    </div>
  );
}
