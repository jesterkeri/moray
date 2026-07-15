'use client';

import { useEffect, useState } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { MORAY_ADDRESS, morayAbi } from './moray';

export type EntryKind = 'deposit' | 'send' | 'withdraw' | 'withdrawDelayed';
export type EntryStatus = 'released' | 'clearing' | 'recalled';

export type Entry = {
  kind: EntryKind;
  status?: EntryStatus; // for send / withdrawDelayed only
  amount: bigint;
  counterparty?: string;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
};

type MinLog = { blockNumber: bigint | null; logIndex: number | null; transactionHash: `0x${string}` | null };

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
    const moray = MORAY_ADDRESS;

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      const common = { address: moray, abi: morayAbi, fromBlock: FROM_BLOCK, toBlock: 'latest' as const };
      try {
        // Phase 1: the user's created / terminal-outflow events.
        const [deps, withdrawns, sends, wreqs] = await Promise.all([
          publicClient.getContractEvents({ ...common, eventName: 'Deposited', args: { user: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'Withdrawn', args: { user: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'TransferCreated', args: { from: address } }),
          publicClient.getContractEvents({ ...common, eventName: 'WithdrawRequested', args: { user: address } }),
        ]);

        // Phase 2: how those in-flight transfers actually ended (bounded to their ids).
        const ids = [
          ...sends.map((l) => l.args.id).filter((x): x is bigint => x !== undefined),
          ...wreqs.map((l) => l.args.id).filter((x): x is bigint => x !== undefined),
        ];
        const terminal = new Map<string, EntryStatus>();
        if (ids.length > 0) {
          const [claimed, cancelledE, reclaimedE] = await Promise.all([
            publicClient.getContractEvents({ ...common, eventName: 'TransferClaimed', args: { id: ids } }),
            publicClient.getContractEvents({ ...common, eventName: 'TransferCancelled', args: { id: ids } }),
            publicClient.getContractEvents({ ...common, eventName: 'TransferReclaimed', args: { id: ids } }),
          ]);
          for (const l of claimed) if (l.args.id !== undefined) terminal.set(l.args.id.toString(), 'released');
          for (const l of cancelledE) if (l.args.id !== undefined) terminal.set(l.args.id.toString(), 'recalled');
          for (const l of reclaimedE) if (l.args.id !== undefined) terminal.set(l.args.id.toString(), 'recalled');
        }

        const list: Entry[] = [];
        const push = (
          kind: EntryKind,
          amount: bigint | undefined,
          l: MinLog,
          extra?: { status?: EntryStatus; counterparty?: string },
        ) => {
          if (amount === undefined) return; // fail closed: never fabricate a 0 amount
          list.push({
            kind,
            amount,
            status: extra?.status,
            counterparty: extra?.counterparty,
            blockNumber: l.blockNumber ?? 0n,
            logIndex: l.logIndex ?? 0,
            txHash: l.transactionHash ?? '',
          });
        };

        for (const l of deps) push('deposit', l.args.amount, l);
        for (const l of withdrawns) push('withdraw', l.args.amount, l);
        for (const l of sends) {
          push('send', l.args.amount, l, {
            status: (l.args.id !== undefined && terminal.get(l.args.id.toString())) || 'clearing',
            counterparty: l.args.to,
          });
        }
        for (const l of wreqs) {
          push('withdrawDelayed', l.args.amount, l, {
            status: (l.args.id !== undefined && terminal.get(l.args.id.toString())) || 'clearing',
          });
        }

        list.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? 1 : -1) : b.logIndex - a.logIndex));

        if (!cancelled) {
          setEntries(list);
          setError(false);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    };

    load(true);
    // One delayed retry catches RPC log-index lag right after an action bumps the key.
    const retry = setTimeout(() => load(false), 3500);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [publicClient, address, refreshKey]);

  return { entries, loading, error };
}
