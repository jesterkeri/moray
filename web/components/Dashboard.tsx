'use client';

import { useEffect, useState } from 'react';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import {
  MORAY_ADDRESS,
  isConfigured,
  morayAbi,
  formatMon,
  shortAddress,
} from '@/lib/moray';
import { formatDuration } from '@/lib/format';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SendIcon,
  ShieldIcon,
  ListIcon,
  CheckIcon,
} from './icons';
import { Modal } from './Modal';
import { SendFlow } from './SendFlow';
import { DepositFlow } from './DepositFlow';
import { WithdrawFlow } from './WithdrawFlow';
import { PendingList } from './PendingList';

type Panel = 'deposit' | 'send' | 'withdraw' | 'safety' | null;

export function Dashboard() {
  const { address } = useAccount();
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);

  const configured = isConfigured();

  const {
    data: vaultBalance,
    isLoading: vaultLoading,
    refetch: refetchVault,
  } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && configured, refetchInterval: 8000 },
  });

  const { data: walletBalance, refetch: refetchWallet } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
          <ActionButton label="Deposit" icon={<ArrowDownIcon />} onClick={() => setPanel('deposit')} />
          <ActionButton label="Send" icon={<SendIcon />} onClick={() => setPanel('send')} />
          <ActionButton label="Withdraw" icon={<ArrowUpIcon />} onClick={() => setPanel('withdraw')} />
          <ActionButton label="Safety" icon={<ShieldIcon />} onClick={() => setPanel('safety')} />
        </div>
      </section>

      <PendingList
        onChange={() => {
          refetchVault();
          refetchWallet();
        }}
      />

      {panel === 'deposit' && (
        <Modal title="Deposit" onClose={() => setPanel(null)}>
          <DepositFlow
            onDone={({ amount }) => {
              setPanel(null);
              refetchVault();
              refetchWallet();
              setToast(`Deposited ${amount} MON into your safe.`);
            }}
          />
        </Modal>
      )}

      {panel === 'send' && (
        <Modal title="Send" onClose={() => setPanel(null)}>
          <SendFlow
            onSent={({ seconds }) => {
              setPanel(null);
              refetchVault();
              setToast(
                seconds === 0
                  ? 'Sent — it clears instantly.'
                  : `Sent. Clearing in ${formatDuration(seconds)} — recall it below any time.`,
              );
            }}
          />
        </Modal>
      )}

      {panel === 'withdraw' && (
        <Modal title="Withdraw" onClose={() => setPanel(null)}>
          <WithdrawFlow
            onDone={({ instant, seconds }) => {
              setPanel(null);
              refetchVault();
              refetchWallet();
              setToast(
                instant
                  ? 'Withdrawn to your wallet.'
                  : `Withdrawal clearing in ${formatDuration(seconds)} — recall it below any time.`,
              );
            }}
          />
        </Modal>
      )}

      {panel === 'safety' && <FlowPlaceholder panel="safety" onClose={() => setPanel(null)} />}

      <section className="section">
        <div className="section-head">
          <span className="h-title" style={{ fontSize: 15 }}>
            Statement
          </span>
          <span className="badge">
            <ListIcon size={14} /> Coming next
          </span>
        </div>
        <div className="card">
          <div className="empty">
            The full statement, your spend by payee from the vault&apos;s on-chain
            events, lands with the next build. Payments in flight already show live
            in Clearing above.
          </div>
        </div>
      </section>

      {toast && (
        <div className="toast">
          <span style={{ color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <CheckIcon size={16} />
          </span>
          {toast}
        </div>
      )}
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
  send: { title: '', desc: '' },
  withdraw: {
    title: 'Withdraw to your wallet',
    desc: 'Small amounts are instant; larger amounts enter a recallable, freezable window.',
  },
  safety: {
    title: 'Safety controls',
    desc: 'Set your safe address, recovery contact, heir and instant limit; panic-freeze or trigger the kill switch.',
  },
};

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
