'use client';

import { useStatement, type Entry } from '@/lib/useStatement';
import { formatMon, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { ArrowDownIcon, ArrowUpIcon, SendIcon, ClockIcon } from './icons';

const MAX = 50;

export function StatementView({ refreshKey }: { refreshKey?: number }) {
  const { entries, loading, error } = useStatement(refreshKey);
  const explorer = monadTestnet.blockExplorers?.default.url;

  if (error) {
    return (
      <div className="empty">
        Couldn&apos;t load your history right now. It reads directly from on-chain
        events, try again shortly.
      </div>
    );
  }
  if (loading && entries.length === 0) {
    return <div className="empty">Loading your history…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="empty">
        No activity yet. Your deposits, sends, and withdrawals will appear here,
        read straight from the vault&apos;s on-chain events.
      </div>
    );
  }

  return (
    <div>
      {entries.slice(0, MAX).map((e, i) => (
        <Row key={`${e.txHash}-${e.logIndex}-${i}`} e={e} explorer={explorer} />
      ))}
      {entries.length > MAX && (
        <div className="stmt-row" style={{ justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>
          Showing the latest {MAX} of {entries.length}
        </div>
      )}
    </div>
  );
}

type Desc = {
  icon: React.ReactNode;
  title: string;
  tag?: string;
  tagClass?: string;
  sign: '+' | '−' | '';
  amountColor: string;
};

function Row({ e, explorer }: { e: Entry; explorer?: string }) {
  const d = describe(e);
  const content = (
    <>
      <span className="stmt-icon">{d.icon}</span>
      <div className="stmt-main">
        <div className="stmt-title">
          {d.title}
          {d.tag && (
            <span className={`badge ${d.tagClass ?? ''}`} style={{ marginLeft: 8, height: 20, fontSize: 11 }}>
              {d.tag}
            </span>
          )}
        </div>
      </div>
      <span className="stmt-amt" style={{ color: d.amountColor }}>
        {d.sign}
        {formatMon(e.amount)} MON
      </span>
    </>
  );

  if (explorer && e.txHash) {
    return (
      <a className="stmt-row" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return <div className="stmt-row">{content}</div>;
}

function describe(e: Entry): Desc {
  const out = 'var(--text)';
  const muted = 'var(--text-muted)';
  switch (e.kind) {
    case 'deposit':
      return { icon: <ArrowDownIcon size={17} />, title: 'Deposit', sign: '+', amountColor: 'var(--accent)' };
    case 'withdraw':
      return { icon: <ArrowUpIcon size={17} />, title: 'Withdrawal', sign: '−', amountColor: out };
    case 'send': {
      const to = shortAddress(e.counterparty);
      if (e.status === 'recalled')
        return { icon: <SendIcon size={17} />, title: `Send to ${to}`, tag: 'Recalled', sign: '', amountColor: muted };
      if (e.status === 'clearing')
        return {
          icon: <SendIcon size={17} />,
          title: `Sending to ${to}`,
          tag: 'Clearing',
          tagClass: 'badge-warning',
          sign: '−',
          amountColor: out,
        };
      return { icon: <SendIcon size={17} />, title: `Sent to ${to}`, sign: '−', amountColor: out };
    }
    case 'withdrawDelayed': {
      if (e.status === 'recalled')
        return { icon: <ArrowUpIcon size={17} />, title: 'Withdrawal', tag: 'Recalled', sign: '', amountColor: muted };
      if (e.status === 'clearing')
        return {
          icon: <ClockIcon size={17} />,
          title: 'Withdrawal',
          tag: 'Clearing',
          tagClass: 'badge-warning',
          sign: '−',
          amountColor: out,
        };
      return { icon: <ArrowUpIcon size={17} />, title: 'Withdrawal', sign: '−', amountColor: out };
    }
  }
}
