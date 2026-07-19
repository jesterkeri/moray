'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { useNow } from '@/lib/useNow';
import { Clock } from './Clock';

type TransferTuple = readonly [string, string, bigint, bigint, number]; // from,to,amount,unlock,status

export function PendingList({
  onChange,
  onWithdrawalOut,
}: {
  onChange?: () => void;
  onWithdrawalOut?: () => void;
}) {
  const { address } = useAccount();
  const now = useNow();
  const enabled = Boolean(address) && Boolean(MORAY_ADDRESS);

  const { data: ids, refetch: refetchIds } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'activePendingIds',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 5000 },
  });

  const { data: reclaimGrace } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'reclaimGrace',
    query: { enabled },
  });
  const { data: newPayeeDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'minNewPayeeDelay',
    query: { enabled },
  });
  const { data: withdrawDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'withdrawDelay',
    query: { enabled },
  });

  const idList = (ids as bigint[] | undefined) ?? [];

  const { data: transfers, refetch: refetchTransfers } = useReadContracts({
    contracts: idList.map((id) => ({
      address: MORAY_ADDRESS,
      abi: morayAbi,
      functionName: 'transfers' as const,
      args: [id] as const,
    })),
    query: { enabled: enabled && idList.length > 0, refetchInterval: 5000 },
  });

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const [actingId, setActingId] = useState<bigint | null>(null);
  // True while a self-withdrawal Release is confirming — its claim() pays MON to
  // the owner's wallet, so we tell the parent to suppress auto-sweep.
  const walletOutRef = useRef(false);
  const { isLoading: mining, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  // Refetch only once the action is actually MINED (not when the wallet returns a
  // hash), so the row clears / balances update against confirmed on-chain state.
  useEffect(() => {
    if (!confirmed) return;
    refetchIds();
    refetchTransfers();
    onChange?.();
    if (walletOutRef.current) {
      walletOutRef.current = false;
      onWithdrawalOut?.();
    }
    setActingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  function act(id: bigint, fn: 'cancel' | 'claim' | 'reclaim', walletOut = false) {
    if (!MORAY_ADDRESS) return;
    setActingId(id);
    walletOutRef.current = walletOut;
    writeContract(
      { address: MORAY_ADDRESS, abi: morayAbi, functionName: fn, args: [id], chainId: monadTestnet.id },
      {
        onError: () => {
          setActingId(null);
          walletOutRef.current = false; // don't let a rejected Release pause auto-sweep later
        },
      },
    );
  }

  const rows = idList
    .map((id, i) => {
      const r = transfers?.[i];
      if (!r || r.status !== 'success' || !r.result) return null;
      const t = r.result as unknown as TransferTuple;
      const status = Number(t[4]);
      if (status !== 0) return null; // only Pending
      return { id, to: t[1], amount: t[2], unlock: Number(t[3]), isSelf: t[0].toLowerCase() === t[1].toLowerCase() };
    })
    .filter(Boolean) as { id: bigint; to: string; amount: bigint; unlock: number; isSelf: boolean }[];

  if (rows.length === 0) return null;

  const busy = isPending || mining;
  const wDelay = withdrawDelay !== undefined ? Number(withdrawDelay) : 0;
  const nDelay = newPayeeDelay !== undefined ? Number(newPayeeDelay) : 0;

  return (
    <section className="section">
      <div className="section-head">
        <span className="h-title" style={{ fontSize: 15 }}>
          Clearing
        </span>
        <span className="badge badge-accent">
          <span className="dot" /> {rows.length} in progress
        </span>
      </div>
      <div className="card">
        {rows.map((row) => {
          const grace = reclaimGrace !== undefined ? Number(reclaimGrace) : Infinity;
          // The clearing window's length, for the clock's depleting arc.
          const total = (row.isSelf ? wDelay : nDelay) || 60;
          // now===0 (pre-first-tick) shows a full clock, never the raw unix time.
          const remaining = now > 0 ? row.unlock - now : total;
          const graceRemaining = now > 0 ? row.unlock + grace - now : Infinity;
          // A self-withdrawal (to == from) can always be claimed to the owner's
          // own wallet, so it never becomes "stuck"; only external sends to a
          // rejecting recipient reach the Reclaim phase.
          const phase: 'clearing' | 'grace' | 'stuck' =
            remaining > 0 ? 'clearing' : row.isSelf || graceRemaining > 0 ? 'grace' : 'stuck';
          const actingThis = busy && actingId === row.id;
          return (
            <div className="pending-row" key={row.id.toString()}>
              {phase === 'clearing' && (
                <span className="pending-clock">
                  <Clock secondsLeft={remaining} totalSeconds={total} tone="accent" size={72} />
                </span>
              )}
              <div className="pending-meta">
                <div className="pending-to">
                  {row.isSelf ? 'Withdrawal to your wallet' : `To ${shortAddress(row.to)}`}
                </div>
                <div className="pending-amt mono">{formatMon(row.amount)} MON</div>
              </div>

              {phase === 'clearing' && (
                <>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(row.id, 'cancel')}>
                    {actingThis ? <span className="spinner-sm" /> : 'Recall'}
                  </button>
                </>
              )}
              {phase === 'grace' && (
                <>
                  <span className="countdown" data-done="true">
                    Cleared
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => act(row.id, 'claim', row.isSelf)}
                  >
                    {actingThis ? <span className="spinner-sm" /> : 'Release'}
                  </button>
                </>
              )}
              {phase === 'stuck' && (
                <>
                  <span className="countdown" data-done="true">
                    Unclaimed
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => act(row.id, 'reclaim')}
                    title="The recipient never collected this. Pull it back into your vault."
                  >
                    {actingThis ? <span className="spinner-sm" /> : 'Reclaim'}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {writeError && (
        <div style={{ color: 'var(--danger)', fontSize: 12.5, margin: '10px 2px 0' }}>
          {writeError.message.split('\n')[0].slice(0, 160)}
        </div>
      )}
    </section>
  );
}
