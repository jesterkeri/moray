'use client';

import { useEffect, useState } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { MORAY_ADDRESS, morayAbi } from './moray';

export type EntryKind = 'deposit' | 'send' | 'withdraw' | 'withdrawRequested';

export type Entry = {
  kind: EntryKind;
  amount: bigint;
  counterparty?: string;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
};

// Start block for the log scan. Set NEXT_PUBLIC_MORAY_FROM_BLOCK to the vault's
// deployment block if the RPC caps eth_getLogs ranges; defaults to 0.
const FROM_BLOCK: bigint = (() => {
  const v = process.env.NEXT_PUBLIC_MORAY_FROM_BLOCK;
  try {
    return v ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
})();

export function useStatement(refreshKey?: number) {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!publicClient || !address || !MORAY_ADDRESS) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const common = {
          address: MORAY_ADDRESS,
          abi: morayAbi,
          fromBlock: FROM_BLOCK,
          toBlock: 'latest' as const,
        };
        const [deps, sends, withdrawns, wreqs] = await Promise.all([
          publicClient.getContractEvents({ ...common, eventName: 'Deposited', args: { user: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'TransferCreated', args: { from: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'Withdrawn', args: { user: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'WithdrawRequested', args: { user: address } }),
        ]);

        const list: Entry[] = [];
        type MinLog = { blockNumber: bigint | null; logIndex: number | null; transactionHash: `0x${string}` | null };
        const push = (kind: EntryKind, amount: bigint | undefined, cp: string | undefined, l: MinLog) => {
          list.push({
            kind,
            amount: amount ?? 0n,
            counterparty: cp,
            blockNumber: l.blockNumber ?? 0n,
            logIndex: l.logIndex ?? 0,
            txHash: l.transactionHash ?? '',
          });
        };
        for (const l of deps) push('deposit', l.args.amount, undefined, l);
        for (const l of sends) push('send', l.args.amount, l.args.to, l);
        for (const l of withdrawns) push('withdraw', l.args.amount, undefined, l);
        for (const l of wreqs) push('withdrawRequested', l.args.amount, undefined, l);

        list.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? 1 : -1) : b.logIndex - a.logIndex));

        if (!cancelled) {
          setEntries(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, address, refreshKey]);

  return { entries, loading, error };
}
