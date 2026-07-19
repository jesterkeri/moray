'use client';

import { useEffect, useState } from 'react';
import { parseEventLogs, type Log } from 'viem';
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

type Meta = { blockNumber: bigint; logIndex: number; txHash: string };

// The public Monad RPC caps eth_getLogs at a 100-block range, so we scan in
// 100-block windows over a bounded recent range rather than deploy->latest.
const RANGE = 100n;
// How far back to look. Monad blocks are sub-second, so this covers a wide
// recent window; older history needs an archival RPC that lifts the getLogs cap.
const SCAN_WINDOW = 2000n;
const BATCH = 6; // concurrent getLogs calls per round

// Floor for the scan: the vault's deployment block (set NEXT_PUBLIC_MORAY_FROM_BLOCK).
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const moray = MORAY_ADDRESS;
    const mine = address.toLowerCase();
    const isMine = (a?: string) => typeof a === 'string' && a.toLowerCase() === mine;

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const latest = await publicClient.getBlockNumber();
        const floor = latest > SCAN_WINDOW ? latest - SCAN_WINDOW + 1n : 0n;
        const start = FROM_BLOCK > floor ? FROM_BLOCK : floor;

        // Build the 100-block windows across the range.
        const windows: [bigint, bigint][] = [];
        for (let from = start; from <= latest; from += RANGE) {
          const to = from + RANGE - 1n > latest ? latest : from + RANGE - 1n;
          windows.push([from, to]);
        }

        // Fetch raw address logs per window, in small concurrent rounds. A single
        // window failing (rate limit) drops to [] rather than failing the whole load.
        const raw: Log[] = [];
        for (let i = 0; i < windows.length && !cancelled; i += BATCH) {
          const round = windows.slice(i, i + BATCH);
          const results = await Promise.all(
            round.map(([fromBlock, toBlock]) =>
              publicClient.getLogs({ address: moray, fromBlock, toBlock }).catch(() => [] as Log[]),
            ),
          );
          for (const r of results) raw.push(...r);
        }
        if (cancelled) return;

        const decoded = parseEventLogs({ abi: morayAbi, logs: raw });

        // First pass: terminal outcomes keyed by transfer id (ids are globally unique).
        const terminal = new Map<string, EntryStatus>();
        for (const l of decoded) {
          const args = l.args as Record<string, unknown>;
          const id = args.id;
          if (id === undefined) continue;
          if (l.eventName === 'TransferClaimed') terminal.set(String(id), 'released');
          else if (l.eventName === 'TransferCancelled') terminal.set(String(id), 'recalled');
          else if (l.eventName === 'TransferReclaimed') terminal.set(String(id), 'recalled');
        }

        const list: Entry[] = [];
        const push = (
          kind: EntryKind,
          amount: unknown,
          meta: Meta,
          extra?: { status?: EntryStatus; counterparty?: string },
        ) => {
          if (typeof amount !== 'bigint') return; // fail closed: never fabricate an amount
          list.push({
            kind,
            amount,
            status: extra?.status,
            counterparty: extra?.counterparty,
            blockNumber: meta.blockNumber,
            logIndex: meta.logIndex,
            txHash: meta.txHash,
          });
        };

        for (const l of decoded) {
          const args = l.args as Record<string, unknown>;
          const meta: Meta = {
            blockNumber: l.blockNumber ?? 0n,
            logIndex: l.logIndex ?? 0,
            txHash: l.transactionHash ?? '',
          };
          switch (l.eventName) {
            case 'Deposited':
              if (isMine(args.user as string)) push('deposit', args.amount, meta);
              break;
            case 'Withdrawn':
              if (isMine(args.user as string)) push('withdraw', args.amount, meta);
              break;
            case 'TransferCreated':
              if (isMine(args.from as string))
                push('send', args.amount, meta, {
                  status: terminal.get(String(args.id)) ?? 'clearing',
                  counterparty: args.to as string,
                });
              break;
            case 'WithdrawRequested':
              if (isMine(args.user as string))
                push('withdrawDelayed', args.amount, meta, {
                  status: terminal.get(String(args.id)) ?? 'clearing',
                });
              break;
          }
        }

        list.sort((a, b) =>
          a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? 1 : -1) : b.logIndex - a.logIndex,
        );

        if (!cancelled) {
          setEntries(list);
          setError(false);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          if (showLoading) setError(true);
        }
      }
    };

    load(true).finally(() => {
      if (!cancelled) {
        retryTimer = setTimeout(() => {
          if (!cancelled) load(false);
        }, 3500);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [publicClient, address, refreshKey]);

  return { entries, loading, error };
}
