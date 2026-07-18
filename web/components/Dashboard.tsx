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
import { monadTestnet } from '@/lib/chain';
import { formatDuration } from '@/lib/format';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SendIcon,
  ShieldIcon,
  ListIcon,
  CheckIcon,
  UsersIcon,
  CopyIcon,
} from './icons';
import { Modal } from './Modal';
import { SendFlow } from './SendFlow';
import { DepositFlow } from './DepositFlow';
import { WithdrawFlow } from './WithdrawFlow';
import { SafetyScreen } from './SafetyScreen';
import { BeneficiariesScreen } from './BeneficiariesScreen';
import { PendingList } from './PendingList';
import { StatementView } from './StatementView';

type Panel = 'deposit' | 'send' | 'withdraw' | 'beneficiaries' | 'safety' | null;

const ZERO = '0x0000000000000000000000000000000000000000';
type AcctTuple = readonly [string, string, string, bigint, bigint, boolean, bigint, bigint, bigint, bigint];

export function Dashboard() {
  const { address } = useAccount();
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statementKey, setStatementKey] = useState(0);
  const bumpStatement = () => setStatementKey((k) => k + 1);

  const configured = isConfigured();
  const explorer = monadTestnet.blockExplorers?.default.url;

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

  const { data: acctData, refetch: refetchAcct } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'accounts',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && configured, refetchInterval: 12000 },
  });
  const acct = acctData as AcctTuple | undefined;
  const frozen = acct?.[5] ?? false;

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

  const refetchAll = () => {
    refetchVault();
    refetchWallet();
    refetchAcct();
    bumpStatement();
  };

  return (
    <div className="moray-container">
      {/* Balance band — the vault figure + your wallet, split by a hairline */}
      <section className="wallet-hero">
        <div className="wallet-hero-main">
          <span className="dash-eyebrow">
            <span className="idx" />
            Vault balance
          </span>
          <div className="wallet-figure">
            <span className="wallet-figure-num mono">
              {vaultLoading ? '···' : formatMon(vaultBalance as bigint | undefined)}
            </span>
            <span className="wallet-figure-unit">MON</span>
          </div>
          <div className="wallet-hero-meta">
            {address && <CopyAddress address={address} />}
            <span className="wallet-tag" data-tone={frozen ? 'frozen' : 'safe'}>
              {frozen ? 'Frozen' : 'Protected'}
            </span>
          </div>
        </div>

        <div className="wallet-hero-side">
          <span className="dash-eyebrow">
            <span className="idx" />
            In your wallet
          </span>
          <div className="wallet-side-figure">
            <span className="wallet-side-num mono">
              {walletBalance ? formatMon(walletBalance.value) : '—'}
            </span>
            <span className="wallet-side-unit">MON</span>
          </div>
          <p className="wallet-side-note">Sitting in your signer, ready to move into the safe.</p>
          <button className="bracket-btn primary" onClick={() => setPanel('deposit')}>
            Deposit
          </button>
        </div>
      </section>

      {/* Actions — a contiguous hairline grid, gold sweeps in on hover */}
      <nav className="wallet-actions">
        <WalletAction
          label="Deposit"
          desc="Add funds to the vault"
          icon={<ArrowDownIcon />}
          onClick={() => setPanel('deposit')}
        />
        <WalletAction
          label="Send"
          desc="Pay, with a recall window"
          icon={<SendIcon />}
          onClick={() => setPanel('send')}
        />
        <WalletAction
          label="Withdraw"
          desc="Move funds to your wallet"
          icon={<ArrowUpIcon />}
          onClick={() => setPanel('withdraw')}
        />
        <WalletAction
          label="Beneficiaries"
          desc="Saved, named payees"
          icon={<UsersIcon />}
          onClick={() => setPanel('beneficiaries')}
        />
        <WalletAction
          label="Safety"
          desc="Guardians, limits, recovery"
          icon={<ShieldIcon />}
          onClick={() => setPanel('safety')}
        />
      </nav>

      <PendingList onChange={refetchAll} />

      {/* Lower band — the ledger, and your live safeguards */}
      <div className="wallet-lower">
        <section className="wallet-activity">
          <div className="dash-section-head">
            <span className="dash-eyebrow">
              <span className="idx" />
              Activity
            </span>
            <span className="dash-badge">
              <ListIcon size={13} /> On-chain
            </span>
          </div>
          <div className="wallet-panel">
            <StatementView refreshKey={statementKey} />
          </div>
        </section>

        <Safeguards acct={acct} explorer={explorer} onManage={() => setPanel('safety')} />
      </div>

      {panel === 'deposit' && (
        <Modal title="Deposit" onClose={() => setPanel(null)}>
          <DepositFlow
            onDone={({ amount }) => {
              setPanel(null);
              refetchAll();
              setToast(`Deposited ${amount} MON into your safe.`);
            }}
          />
        </Modal>
      )}

      {panel === 'send' && (
        <Modal title="Send" onClose={() => setPanel(null)}>
          <SendFlow
            onSent={({ seconds, known }) => {
              setPanel(null);
              refetchVault();
              bumpStatement();
              setToast(
                !known
                  ? 'Sent. Check Clearing below.'
                  : seconds === 0
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
            onDone={({ instant, seconds, known }) => {
              setPanel(null);
              refetchVault();
              refetchWallet();
              bumpStatement();
              setToast(
                !known
                  ? 'Submitted. Check Clearing below.'
                  : instant
                    ? 'Withdrawn to your wallet.'
                    : `Withdrawal clearing in ${formatDuration(seconds)} — recall it below any time.`,
              );
            }}
          />
        </Modal>
      )}

      {panel === 'beneficiaries' && (
        <Modal title="Beneficiaries" onClose={() => setPanel(null)}>
          <BeneficiariesScreen />
        </Modal>
      )}

      {panel === 'safety' && (
        <Modal title="Safety" onClose={() => setPanel(null)}>
          <SafetyScreen onChange={refetchAll} />
        </Modal>
      )}

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

/** A live read of the on-chain guardians + limits — the safe's protective state. */
function Safeguards({
  acct,
  explorer,
  onManage,
}: {
  acct: AcctTuple | undefined;
  explorer: string | undefined;
  onManage: () => void;
}) {
  const loaded = acct !== undefined;
  const isSet = (x?: string) => Boolean(x && x !== ZERO);
  const safe = acct?.[0];
  const recovery = acct?.[1];
  const heir = acct?.[2];
  const instantLimit = acct?.[6];

  const rows: { label: string; set: boolean; value: string; addr?: string }[] = [
    { label: 'Safe address', set: isSet(safe), value: isSet(safe) ? shortAddress(safe) : 'Not set', addr: safe },
    { label: 'Recovery contact', set: isSet(recovery), value: isSet(recovery) ? shortAddress(recovery) : 'Not set', addr: recovery },
    { label: 'Heir', set: isSet(heir), value: isSet(heir) ? shortAddress(heir) : 'Not set', addr: heir },
    {
      label: 'Instant limit',
      set: instantLimit !== undefined && instantLimit > 0n,
      value: instantLimit !== undefined ? `${formatMon(instantLimit)} MON` : '—',
    },
  ];

  return (
    <section className="safeguards">
      <div className="dash-section-head">
        <span className="dash-eyebrow">
          <span className="idx" />
          Safeguards
        </span>
        <span className="dash-badge">
          <ShieldIcon size={13} /> Live
        </span>
      </div>
      <div className="wallet-panel safeguards-panel">
        {rows.map((r) => (
          <div className="safeguard-row" key={r.label}>
            <div className="safeguard-head">
              <span className={`safeguard-dot${r.set ? ' on' : ''}`} />
              <span className="safeguard-label">{r.label}</span>
            </div>
            {r.addr && r.set && explorer ? (
              <a
                className="safeguard-value mono link"
                href={`${explorer}/address/${r.addr}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {r.value}
              </a>
            ) : (
              <span className={`safeguard-value mono${r.set ? '' : ' muted'}`}>
                {loaded ? r.value : '…'}
              </span>
            )}
          </div>
        ))}
        <button className="bracket-btn safeguards-manage" onClick={onManage}>
          Manage in Safety
        </button>
      </div>
    </section>
  );
}

function WalletAction({
  label,
  desc,
  icon,
  onClick,
}: {
  label: string;
  desc: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="wallet-action" onClick={onClick}>
      <span className="wallet-action-icon">{icon}</span>
      <span className="wallet-action-label">{label}</span>
      <span className="wallet-action-desc">{desc}</span>
    </button>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure context / permissions): leave the address visible to copy by hand */
    }
  }

  return (
    <button
      className="copy-address"
      onClick={copy}
      title="Copy your wallet address"
      aria-label={copied ? 'Address copied' : 'Copy your wallet address'}
    >
      <span className="mono">{shortAddress(address)}</span>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
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
