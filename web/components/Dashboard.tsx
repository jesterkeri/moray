'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
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
import { useAutoDeposit } from '@/lib/useAutoDeposit';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SendIcon,
  ShieldIcon,
  ListIcon,
  CheckIcon,
  UsersIcon,
  CopyIcon,
  HomeIcon,
  HourglassIcon,
  LogOutIcon,
  InfoIcon,
} from './icons';
import { MorayMark } from './MorayMark';
import { ThemeToggle } from './ThemeToggle';
import { Modal } from './Modal';
import { SendFlow } from './SendFlow';
import { DepositFlow } from './DepositFlow';
import { WithdrawFlow } from './WithdrawFlow';
import { SafetyScreen } from './SafetyScreen';
import { BeneficiariesScreen } from './BeneficiariesScreen';
import { PendingList } from './PendingList';
import { StatementView } from './StatementView';

type Panel = 'deposit' | 'send' | 'withdraw' | null;
type View = 'overview' | 'activity' | 'payees' | 'inheritance' | 'safety';

const ZERO = '0x0000000000000000000000000000000000000000';
type AcctTuple = readonly [string, string, string, bigint, bigint, boolean, bigint, bigint, bigint, bigint];

export function Dashboard() {
  const { address } = useAccount();
  const { user, logout } = usePrivy();
  const [view, setView] = useState<View>('overview');
  const [panel, setPanel] = useState<Panel>(null);
  const [infoView, setInfoView] = useState<View | null>(null);
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

  const refetchAll = () => {
    refetchVault();
    refetchWallet();
    refetchAcct();
    bumpStatement();
  };

  // Auto-deposit: sweep wallet funds (above a gas reserve) into the vault so it's
  // the real spendable balance. A user-controlled, persisted toggle (not silent):
  // it only runs when idle on the overview, and is suppressed for the session
  // after any withdrawal so funds you pulled out aren't swept back.
  const [autoSweep, setAutoSweep] = useState(true);
  const [sweepSuppressed, setSweepSuppressed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('moray-autosweep') === '0') setAutoSweep(false);
    } catch {
      /* storage blocked: default on */
    }
  }, []);
  const toggleAutoSweep = () =>
    setAutoSweep((v) => {
      const next = !v;
      try {
        localStorage.setItem('moray-autosweep', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (next) setSweepSuppressed(false);
      return next;
    });
  useAutoDeposit({
    walletBalance: walletBalance?.value,
    enabled:
      configured && Boolean(address) && autoSweep && view === 'overview' && panel === null,
    paused: sweepSuppressed,
    onSwept: (amount) => {
      refetchAll();
      setToast(`Moved ${formatMon(amount)} MON into your safe.`);
    },
  });

  if (!configured) {
    return <NotDeployed />;
  }

  const email = user?.email?.address;

  return (
    <div className="dash-shell">
      <aside className="dash-rail">
        <div className="rail-top">
          <div className="rail-logo" title="Moray">
            <MorayMark size={26} />
          </div>
          <span className="rail-wordmark">Moray</span>
        </div>

        <nav className="rail-nav">
          <RailItem icon={<HomeIcon size={19} />} label="Overview" active={view === 'overview'} onClick={() => setView('overview')} />
          <RailItem icon={<ListIcon size={19} />} label="Activity" active={view === 'activity'} onClick={() => setView('activity')} />
          <RailItem icon={<UsersIcon size={19} />} label="Beneficiaries" active={view === 'payees'} onClick={() => setView('payees')} />
          <RailItem icon={<HourglassIcon size={19} />} label="Dead Man’s Switch" active={view === 'inheritance'} onClick={() => setView('inheritance')} />
          <RailItem icon={<ShieldIcon size={19} />} label="Safety" active={view === 'safety'} onClick={() => setView('safety')} />
        </nav>

        <div className="rail-foot">
          <ThemeToggle />
          <button className="rail-icon" title="Log out" aria-label="Log out" onClick={() => logout()}>
            <LogOutIcon size={18} />
            <span className="rail-label">Log out</span>
          </button>
          <div className="rail-user">
            <span className="rail-avatar" title={email ?? shortAddress(address)}>
              {(email ?? 'M').charAt(0).toUpperCase()}
            </span>
            <span className="rail-email">{email ?? shortAddress(address)}</span>
          </div>
        </div>
      </aside>

      <main className="dash-main">
        {view === 'overview' && (
          <>
            <header className="dash-head">
              <div>
                <div className="dash-crumb">Wallet · Overview</div>
                <h1 className="dash-title">Your safe</h1>
              </div>
              <div className="dash-head-nav">
                {address && <CopyAddress address={address} />}
                <button className="info-btn" onClick={() => setInfoView('overview')} aria-label="About this page" title="About this page">
                  <InfoIcon size={18} />
                </button>
              </div>
            </header>

            <PendingList onChange={refetchAll} onWithdrawalOut={() => setSweepSuppressed(true)} />

            <div className="dash-grid">
              <section className="dcard card-balance">
                <span className="dcard-label">Vault balance</span>
                <div className="balance-figure">
                  <span className="balance-num">
                    {vaultLoading ? '···' : formatMon(vaultBalance as bigint | undefined)}
                  </span>
                  <span className="balance-unit">MON</span>
                </div>
                <div className="balance-foot">
                  <span className="chip-status" data-tone={frozen ? 'frozen' : 'safe'}>
                    {frozen ? 'Frozen' : 'Protected'}
                  </span>
                  <div className="balance-cta">
                    <button className="pill pill-primary" onClick={() => setPanel('deposit')}>
                      Deposit
                    </button>
                    <button className="pill" onClick={() => setPanel('send')}>
                      Send
                    </button>
                  </div>
                </div>
              </section>

              <section className="dcard card-wallet accent">
                <span className="dcard-label on-accent">In your wallet</span>
                <div className="balance-figure">
                  <span className="balance-num">
                    {walletBalance ? formatMon(walletBalance.value) : '—'}
                  </span>
                  <span className="balance-unit on-accent">MON</span>
                </div>
                <p className="card-note on-accent">
                  {!autoSweep
                    ? 'Auto-sweep is off. Use Move to safe to deposit.'
                    : sweepSuppressed
                      ? 'Auto-sweep paused after your withdrawal, so these funds stay put.'
                      : 'Kept for gas. Anything more moves into your safe automatically.'}
                </p>
                <div className="autosweep">
                  <span className="autosweep-status">
                    Auto-sweep {autoSweep ? (sweepSuppressed ? 'paused' : 'on') : 'off'}
                  </span>
                  {autoSweep && sweepSuppressed ? (
                    <button className="autosweep-link" onClick={() => setSweepSuppressed(false)}>
                      Resume
                    </button>
                  ) : (
                    <button className="autosweep-link" onClick={toggleAutoSweep}>
                      {autoSweep ? 'Turn off' : 'Turn on'}
                    </button>
                  )}
                </div>
                <button className="pill pill-onaccent" onClick={() => setPanel('deposit')}>
                  Move to safe now
                </button>
              </section>

              <section className="dcard card-move">
                <span className="dcard-label">Move money</span>
                <div className="quick-actions">
                  <button className="quick-action" onClick={() => setPanel('deposit')}>
                    <span className="qa-icon">
                      <ArrowDownIcon size={20} />
                    </span>
                    <span className="qa-label">Deposit</span>
                    <span className="qa-sub">Add funds to the vault</span>
                  </button>
                  <button className="quick-action" onClick={() => setPanel('send')}>
                    <span className="qa-icon">
                      <SendIcon size={20} />
                    </span>
                    <span className="qa-label">Send</span>
                    <span className="qa-sub">Pay, with a recall window</span>
                  </button>
                  <button className="quick-action" onClick={() => setPanel('withdraw')}>
                    <span className="qa-icon">
                      <ArrowUpIcon size={20} />
                    </span>
                    <span className="qa-label">Withdraw</span>
                    <span className="qa-sub">Move funds to your wallet</span>
                  </button>
                </div>
              </section>

              <section className="dcard card-safeguards">
                <div className="dcard-head">
                  <span className="dcard-label">Safeguards</span>
                  <span className="dcard-tag">
                    <ShieldIcon size={13} /> Live
                  </span>
                </div>
                <Safeguards acct={acct} explorer={explorer} />
                <button className="pill pill-ghost" onClick={() => setView('safety')}>
                  Manage in Safety
                </button>
              </section>
            </div>
          </>
        )}

        {view === 'activity' && (
          <SubPage title="Activity" crumb="On-chain history" onBack={() => setView('overview')} onInfo={() => setInfoView('activity')}>
            <div className="dcard">
              <div className="dcard-head">
                <span className="dcard-label">Movements</span>
                <span className="dcard-tag">
                  <ListIcon size={13} /> On-chain
                </span>
              </div>
              <div className="dcard-body">
                <StatementView refreshKey={statementKey} />
              </div>
            </div>
          </SubPage>
        )}

        {view === 'payees' && (
          <SubPage title="Beneficiaries" crumb="Saved payees" onBack={() => setView('overview')} onInfo={() => setInfoView('payees')}>
            <BeneficiariesScreen />
          </SubPage>
        )}

        {view === 'inheritance' && (
          <SubPage title="Dead Man’s Switch" crumb="Inheritance" onBack={() => setView('overview')} onInfo={() => setInfoView('inheritance')}>
            <SafetyScreen variant="inheritance" onChange={refetchAll} />
          </SubPage>
        )}

        {view === 'safety' && (
          <SubPage title="Safety" crumb="Guardians & limits" onBack={() => setView('overview')} onInfo={() => setInfoView('safety')}>
            <SafetyScreen variant="guardians" onChange={refetchAll} />
          </SubPage>
        )}
      </main>

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
                    ? 'Sent — no clearing hold.'
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
              setSweepSuppressed(true);
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

      {infoView && (
        <Modal title={PAGE_INFO[infoView].title} onClose={() => setInfoView(null)}>
          <div className="info-body">{PAGE_INFO[infoView].body}</div>
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

const PAGE_INFO: Record<View, { title: string; body: React.ReactNode }> = {
  overview: {
    title: 'About your overview',
    body: (
      <>
        <p>
          This is your safe at a glance. <strong>Vault balance</strong> is what&rsquo;s protected
          inside the Moray contract; <strong>In your wallet</strong> is what&rsquo;s still in your
          signer, ready to deposit.
        </p>
        <p>
          <strong>Move money</strong> lets you deposit into the vault, send to someone (with a
          recallable clearing window), or withdraw back to your wallet.
        </p>
        <p>
          <strong>Activity</strong> and <strong>Safeguards</strong> each have their own page for the
          full picture; the overview shows your protection status at a glance.
        </p>
      </>
    ),
  },
  activity: {
    title: 'About activity',
    body: (
      <>
        <p>
          Your complete on-chain history, read straight from the vault&rsquo;s events, deposits,
          sends (with their clearing status), and withdrawals.
        </p>
        <p>
          A send or large withdrawal shows as <strong>Clearing</strong> while it&rsquo;s inside its
          recallable window, then <strong>Sent</strong> once it lands or <strong>Recalled</strong> if
          you pulled it back. Every row links to the transaction on the explorer.
        </p>
      </>
    ),
  },
  payees: {
    title: 'About beneficiaries',
    body: (
      <>
        <p>
          Beneficiaries are a private address book of the people and services you pay. Saving and
          naming an address means Moray <strong>recognizes it</strong> when you send.
        </p>
        <p>
          It also arms the <strong>address-poisoning check</strong>: if someone sends you a lookalike
          address that mimics a saved beneficiary, Moray hard-flags it before you can pay it.
        </p>
        <p>
          The list is saved on this device and never leaves it. Naming a payee is for recognition
          only, it never shortens a hold: a brand-new address still clears through its window.
        </p>
      </>
    ),
  },
  inheritance: {
    title: 'About the Dead Man’s Switch',
    body: (
      <>
        <p>
          The Dead Man&rsquo;s Switch is how your funds reach someone you trust if you can no longer
          reach them yourself. You name an <strong>heir</strong> and an <strong>inactivity
          period</strong>.
        </p>
        <p>
          If you go silent for that whole period, your heir can begin inheriting, on a delay you can
          <strong> always cancel</strong> just by checking in or using your vault.
        </p>
        <p>
          Every change here is <strong>time-locked and reversible</strong>, so no one can quietly
          set themselves as your heir and drain the vault.
        </p>
      </>
    ),
  },
  safety: {
    title: 'About Safety',
    body: (
      <>
        <p>
          Safety is where you set your on-chain guardians and limits. The <strong>safe
          address</strong> is where the kill switch sweeps your funds. The <strong>recovery
          contact</strong> can freeze your vault or sweep it to your safe address if your key is
          stolen, but can never take your funds.
        </p>
        <p>
          The <strong>instant limit</strong> caps how much can leave instantly each day; anything
          above it is delayed and recallable.
        </p>
        <p>
          <strong>Panic freeze</strong> instantly stops all money leaving (reversible with a
          time-locked unfreeze). The <strong>kill switch</strong> sweeps everything to your safe
          address and freezes the vault. Powerful changes are time-locked; protective freezes are
          instant.
        </p>
      </>
    ),
  },
};

function RailItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rail-icon${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span className="rail-label">{label}</span>
    </button>
  );
}

function SubPage({
  title,
  crumb,
  onBack,
  onInfo,
  children,
}: {
  title: string;
  crumb?: string;
  onBack: () => void;
  onInfo: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="dash-head">
        <div>
          <div className="dash-crumb">Wallet · {crumb ?? title}</div>
          <h1 className="dash-title">{title}</h1>
        </div>
        <div className="dash-head-nav">
          <button className="info-btn" onClick={onInfo} aria-label="About this page" title="About this page">
            <InfoIcon size={18} />
          </button>
          <button className="pill subpage-back" onClick={onBack}>
            ← Overview
          </button>
        </div>
      </header>
      <div className="subpage-body">{children}</div>
    </>
  );
}

/** A live read of the on-chain guardians + limits — the safe's protective state. */
function Safeguards({
  acct,
  explorer,
}: {
  acct: AcctTuple | undefined;
  explorer: string | undefined;
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
    <div className="safeguard-list">
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
    </div>
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
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

function NotDeployed() {
  return (
    <div className="dcard" style={{ padding: 32, maxWidth: 640, margin: '40px auto' }}>
      <span className="dcard-label">Almost there</span>
      <h1 className="dash-title" style={{ margin: '10px 0' }}>
        Point the app at your vault
      </h1>
      <p className="card-note">
        Deploy <span className="mono">MorayVault</span> to Monad testnet, then set{' '}
        <span className="mono">NEXT_PUBLIC_MORAY_ADDRESS</span> and restart. Your balance
        and activity will read live from that contract.
      </p>
    </div>
  );
}
