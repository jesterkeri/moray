'use client';

import { usePrivy } from '@privy-io/react-auth';
import { SendIcon, ShieldIcon, ClockIcon } from './icons';

export function Landing() {
  const { login, ready } = usePrivy();

  return (
    <div className="landing">
      <span className="eyebrow">The self-custodial safe</span>
      <h1>
        Bank-grade protection.
        <br />
        You hold the keys.
      </h1>
      <p className="lede">
        A focused safe for the crypto you can&apos;t afford to lose. No seed
        phrase, no dapp browser. It does one job better than anything else:
        protect the funds inside it.
      </p>

      <button
        className="btn btn-primary"
        style={{ height: 50, padding: '0 26px', fontSize: 15 }}
        disabled={!ready}
        onClick={() => login()}
      >
        Enter your safe
      </button>

      <div className="landing-points">
        <Point
          icon={<ClockIcon />}
          title="A wrong send is recallable"
          desc="Payments clear through a window you control. New payees are held so a scam or a typo never leaves instantly."
        />
        <Point
          icon={<ShieldIcon />}
          title="A stolen key can't drain you"
          desc="Instant cash-out is capped at a small daily allowance. Larger moves are delayed, and a recovery contact can freeze or sweep to your cold wallet."
        />
        <Point
          icon={<SendIcon />}
          title="Your funds outlive lost access"
          desc="Name an heir. If you go silent, they inherit after a delay you can always veto by simply using your vault."
        />
      </div>
    </div>
  );
}

function Point({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="point">
      <span className="point-icon">{icon}</span>
      <div>
        <div className="point-title">{title}</div>
        <div className="point-desc">{desc}</div>
      </div>
    </div>
  );
}
