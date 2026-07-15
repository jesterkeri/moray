'use client';

import { useStatement, type Entry } from '@/lib/useStatement';
import { formatMon, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { ArrowDownIcon, ArrowUpIcon, SendIcon, ClockIcon } from './icons';

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
      {entries.slice(0, 50).map((e, i) => (
        <Row key={`${e.txHash}-${e.logIndex}-${i}`} e={e} explorer={explorer} />
      ))}
    </div>
  );
}

function Row({ e, explorer }: { e: Entry; explorer?: string }) {
  const meta = describe(e);
  const inbound = e.kind === 'deposit';
  const content = (
    <>
      <span className="stmt-icon">{meta.icon}</span>
      <div className="stmt-main">
        <div className="stmt-title">{meta.title}</div>
      </div>
      <span
        className="stmt-amt"
        style={{ color: inbound ? 'var(--accent)' : 'var(--text)' }}
      >
        {inbound ? '+' : '−'}
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

function describe(e: Entry): { icon: React.ReactNode; title: string } {
  switch (e.kind) {
    case 'deposit':
      return { icon: <ArrowDownIcon size={17} />, title: 'Deposit' };
    case 'send':
      return { icon: <SendIcon size={17} />, title: `Sent to ${shortAddress(e.counterparty)}` };
    case 'withdraw':
      return { icon: <ArrowUpIcon size={17} />, title: 'Withdrawal' };
    case 'withdrawRequested':
      return { icon: <ClockIcon size={17} />, title: 'Withdrawal (clearing)' };
  }
}
