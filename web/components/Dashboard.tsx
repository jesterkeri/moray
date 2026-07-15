'use client';

import { useState } from 'react';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import {
  MORAY_ADDRESS,
  isConfigured,
  morayAbi,
  formatMon,
  shortAddress,
} from '@/lib/moray';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SendIcon,
  ShieldIcon,
  ListIcon,
} from './icons';

type Panel = 'deposit' | 'send' | 'withdraw' | 'safety' | null;

export function Dashboard() {
  const { address } = useAccount();
  const [panel, setPanel] = useState<Panel>(null);

  const configured = isConfigured();

  const { data: vaultBalance, isLoading: vaultLoading } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && configured, refetchInterval: 8000 },
  });

  const { data: walletBalance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  if (!configured) {
    return (
      <div className="moray-container">
        <NotDeployed />
      </div>
    );
  }

  return (
    <div className="moray-container">
      <section className="card hero">
        <span className="eyebrow">Vault balance</span>
        <div className="hero-amount">
          <span className="hero-number mono">
            {vaultLoading ? '···' : formatMon(vaultBalance as bigint | undefined)}
          </span>
          <span className="hero-symbol">MON</span>
        </div>
        <div className="hero-sub">
          {walletBalance
            ? `${formatMon(walletBalance.value)} MON in your wallet, ready to deposit`
            : 'Protected inside your Moray safe'}
          {address && (
            <>
              {'  ·  '}
              <span className="mono">{shortAddress(address)}</span>
            </>
          )}
        </div>

        <div className="action-grid">
          <ActionButton
            label="Deposit"
            icon={<ArrowDownIcon />}
            onClick={() => setPanel('deposit')}
          />
          <ActionButton
            label="Send"
            icon={<SendIcon />}
            onClick={() => setPanel('send')}
          />
          <ActionButton
            label="Withdraw"
            icon={<ArrowUpIcon />}
            onClick={() => setPanel('withdraw')}
          />
          <ActionButton
            label="Safety"
            icon={<ShieldIcon />}
            onClick={() => setPanel('safety')}
          />
        </div>
      </section>

      {panel && <FlowPlaceholder panel={panel} onClose={() => setPanel(null)} />}

      <section className="section">
        <div className="section-head">
          <span className="h-title" style={{ fontSize: 15 }}>
            Activity
          </span>
          <span className="badge">
            <ListIcon size={14} /> Statement
          </span>
        </div>
        <div className="card">
          <div className="empty">
            No activity yet. Deposits, sends, and recalls will appear here, read
            straight from the vault&apos;s on-chain events.
          </div>
        </div>
      </section>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="action" onClick={onClick}>
      <span className="action-icon">{icon}</span>
      {label}
    </button>
  );
}

const FLOW_COPY: Record<Exclude<Panel, null>, { title: string; desc: string }> = {
  deposit: {
    title: 'Deposit into your safe',
    desc: 'Move MON from your wallet into the vault, where the protections apply.',
  },
  send: {
    title: 'Send through a clearing window',
    desc: 'Pick a recipient and amount. New or risky payees are held so you can recall before it clears.',
  },
  withdraw: {
    title: 'Withdraw to your wallet',
    desc: 'Small amounts are instant; larger amounts enter a recallable, freezable window.',
  },
  safety: {
    title: 'Safety controls',
    desc: 'Set your safe address, recovery contact, heir and instant limit; panic-freeze or trigger the kill switch.',
  },
};

// Honest placeholder: the shell + live reads are real; these action flows are the
// next build step. No fake data, no fake success.
function FlowPlaceholder({ panel, onClose }: { panel: Exclude<Panel, null>; onClose: () => void }) {
  const copy = FLOW_COPY[panel];
  return (
    <section className="card card-pad section" style={{ marginTop: 16 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="h-title" style={{ fontSize: 16 }}>
          {copy.title}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        {copy.desc}
      </p>
      <span className="badge badge-accent">
        <span className="dot" /> Flow lands in the next build step
      </span>
    </section>
  );
}

function NotDeployed() {
  return (
    <section className="card card-pad">
      <span className="eyebrow">Almost there</span>
      <h1 className="h-title" style={{ margin: '8px 0' }}>
        Point the app at your vault
      </h1>
      <p className="muted">
        Deploy <span className="mono">MorayVault</span> to Monad testnet, then set{' '}
        <span className="mono">NEXT_PUBLIC_MORAY_ADDRESS</span> in{' '}
        <span className="mono">web/.env.local</span> and restart. Your balance and
        activity will read live from that contract.
      </p>
    </section>
  );
}
