'use client';

import { useState } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/useNow';

type TransferTuple = readonly [string, string, bigint, bigint, number]; // from,to,amount,unlock,status

export function PendingList({ onChange }: { onChange?: () => void }) {
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

  const { writeContract, data: hash, isPending } = useWriteContract();
  const [actingId, setActingId] = useState<bigint | null>(null);
  const { isLoading: mining } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: Boolean(hash),
      // refetch lists when the action confirms
    },
  });

  function act(id: bigint, fn: 'cancel' | 'claim' | 'reclaim') {
    if (!MORAY_ADDRESS) return;
    setActingId(id);
    writeContract(
      { address: MORAY_ADDRESS, abi: morayAbi, functionName: fn, args: [id], chainId: monadTestnet.id },
      {
        onSettled: () => {
          setTimeout(() => {
            refetchIds();
            refetchTransfers();
            onChange?.();
          }, 1500);
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
          const remaining = now > 0 ? row.unlock - now : row.unlock;
          const graceRemaining = now > 0 ? row.unlock + grace - now : Infinity;
          // A self-withdrawal (to == from) can always be claimed to the owner's
          // own wallet, so it never becomes "stuck"; only external sends to a
          // rejecting recipient reach the Reclaim phase.
          const phase: 'clearing' | 'grace' | 'stuck' =
            remaining > 0 ? 'clearing' : row.isSelf || graceRemaining > 0 ? 'grace' : 'stuck';
          const actingThis = busy && actingId === row.id;
          return (
            <div className="pending-row" key={row.id.toString()}>
              <div className="pending-meta">
                <div className="pending-to">
                  {row.isSelf ? 'Withdrawal to your wallet' : `To ${shortAddress(row.to)}`}
                </div>
                <div className="pending-amt mono">{formatMon(row.amount)} MON</div>
              </div>

              {phase === 'clearing' && (
                <>
                  <span className="countdown">{formatDuration(remaining)}</span>
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
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(row.id, 'claim')}>
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
    </section>
  );
}
