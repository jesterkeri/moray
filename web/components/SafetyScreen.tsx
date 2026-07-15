'use client';

import { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon, parseMon, shortAddress } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { ShieldIcon, LockIcon, ClockIcon } from './icons';

const ZERO = '0x0000000000000000000000000000000000000000';

const KIND = {
  SetSafe: 1,
  SetRecovery: 2,
  SetHeir: 3,
  SetInactivity: 4,
  SetInstantLimit: 5,
  Unfreeze: 6,
} as const;

const KIND_LABEL: Record<number, string> = {
  1: 'Safe address',
  2: 'Recovery contact',
  3: 'Heir',
  4: 'Inactivity period',
  5: 'Instant limit',
  6: 'Unfreeze',
};

type AcctTuple = readonly [string, string, string, bigint, bigint, boolean, bigint, bigint, bigint, bigint];
type PendingTuple = readonly [number, string, bigint, bigint];
type RowType = 'address' | 'duration' | 'amount';

export function SafetyScreen({ onChange }: { onChange?: () => void }) {
  const { address } = useAccount();
  const now = useNow();
  const enabled = Boolean(address) && Boolean(MORAY_ADDRESS);

  const { data: acctData, refetch: refetchAcct } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'accounts',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 8000 },
  });
  const { data: pendingData, refetch: refetchPending } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'pendingChange',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 8000 },
  });
  const { data: configDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'configDelay',
    query: { enabled },
  });

  const a = acctData as unknown as AcctTuple | undefined;
  const p = pendingData as unknown as PendingTuple | undefined;
  const configReady = acctData !== undefined && pendingData !== undefined && configDelay !== undefined;

  const safe = a?.[0];
  const recovery = a?.[1];
  const heir = a?.[2];
  const inactivity = a ? Number(a[3]) : 0;
  const frozen = a?.[5] ?? false;
  const instantLimit = a?.[6];
  const safeSetAt = a ? Number(a[9]) : 0;

  const pKind = p ? Number(p[0]) : 0;
  const pExecuteAfter = p ? Number(p[3]) : 0;
  const hasPending = pKind !== 0;
  const pMatured = hasPending && now > 0 && now >= pExecuteAfter;

  const cfgDelay = configDelay !== undefined ? Number(configDelay) : undefined;
  const hasSafe = Boolean(safe && safe !== ZERO);
  const safeMatured = hasSafe && cfgDelay !== undefined && now > 0 && now >= safeSetAt + cfgDelay;

  const { writeContract, data: hash, isPending } = useWriteContract();
  const {
    isLoading: mining,
    isSuccess: confirmed,
    isError: receiptFailed,
  } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [killConfirm, setKillConfirm] = useState(false);

  const busy = isPending || mining;

  useEffect(() => {
    if (!confirmed) return;
    refetchAcct();
    refetchPending();
    onChange?.();
    setEditing(null);
    setEditValue('');
    setBusyLabel(null);
    setKillConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  // A mined-but-failed tx (revert) or a receipt-wait error must not leave a button
  // spinning forever.
  useEffect(() => {
    if (receiptFailed) {
      setBusyLabel(null);
      setKillConfirm(false);
    }
  }, [receiptFailed]);

  // If readiness or the safe's maturity drops (query reset, read failure), drop any
  // armed kill-switch confirm so a sweep can't fire on stale state.
  useEffect(() => {
    if (!configReady || !safeMatured) setKillConfirm(false);
  }, [configReady, safeMatured]);

  // On account switch, wipe ALL transient state so a Save or armed Confirm can't
  // act on the previous account's (or another account's) state.
  useEffect(() => {
    setEditing(null);
    setEditValue('');
    setEditError(null);
    setKillConfirm(false);
  }, [address]);

  // Close an open edit form if readiness drops while it's mounted.
  useEffect(() => {
    if (!configReady) {
      setEditing(null);
      setEditValue('');
      setEditError(null);
    }
  }, [configReady]);

  function requestChange(kind: number, addr: string, num: bigint, label: string) {
    if (!MORAY_ADDRESS) return;
    setBusyLabel(label);
    writeContract(
      {
        address: MORAY_ADDRESS,
        abi: morayAbi,
        functionName: 'requestChange',
        args: [kind, addr as `0x${string}`, num],
        chainId: monadTestnet.id,
      },
      { onError: () => setBusyLabel(null) },
    );
  }

  function simpleWrite(fn: 'executeChange' | 'cancelChange' | 'panic' | 'checkIn', label: string) {
    if (!MORAY_ADDRESS) return;
    setBusyLabel(label);
    writeContract(
      { address: MORAY_ADDRESS, abi: morayAbi, functionName: fn, chainId: monadTestnet.id },
      { onError: () => setBusyLabel(null) },
    );
  }

  function killSwitch() {
    if (!MORAY_ADDRESS || !address) return;
    setBusyLabel('kill');
    writeContract(
      {
        address: MORAY_ADDRESS,
        abi: morayAbi,
        functionName: 'killSwitch',
        args: [address],
        chainId: monadTestnet.id,
      },
      { onError: () => setBusyLabel(null) },
    );
  }

  function openEdit(kind: number) {
    setEditing(kind);
    setEditValue('');
    setEditError(null);
  }

  function saveEdit(kind: number, type: RowType) {
    if (!configReady || hasPending) return; // never submit against stale/pending state
    setEditError(null);
    if (type === 'address') {
      if (!isAddress(editValue)) return setEditError('Enter a valid address.');
      if (address && editValue.toLowerCase() === address.toLowerCase())
        return setEditError('That is your own account.');
      requestChange(kind, editValue, 0n, KIND_LABEL[kind]);
    } else if (type === 'duration') {
      if (!/^\d+$/.test(editValue)) return setEditError('Enter a whole number of seconds.');
      const secs = BigInt(editValue); // parse the digit string directly, no Number() rounding
      if (secs <= 0n) return setEditError('Enter a positive number of seconds.');
      requestChange(kind, ZERO, secs, KIND_LABEL[kind]);
    } else {
      const wei = parseMon(editValue);
      if (wei === null) return setEditError('Enter a valid amount.');
      requestChange(kind, ZERO, wei, KIND_LABEL[kind]);
    }
  }

  const fmtAddr = (x?: string) => (x && x !== ZERO ? shortAddress(x) : 'Not set');

  const rows: { kind: number; label: string; value: string; hint: string; type: RowType }[] = [
    {
      kind: KIND.SetSafe,
      label: 'Safe address',
      value: configReady ? fmtAddr(safe) : '…',
      hint: 'Where the kill switch sweeps your funds. Set it from a trusted device.',
      type: 'address',
    },
    {
      kind: KIND.SetRecovery,
      label: 'Recovery contact',
      value: configReady ? fmtAddr(recovery) : '…',
      hint: 'Can freeze your vault or sweep to your safe address if your key is stolen. Can never take your funds.',
      type: 'address',
    },
    {
      kind: KIND.SetHeir,
      label: 'Heir',
      value: configReady ? fmtAddr(heir) : '…',
      hint: 'Inherits after you go inactive, on a delay you can always veto by using your vault.',
      type: 'address',
    },
    {
      kind: KIND.SetInactivity,
      label: 'Inactivity period',
      value: configReady ? (inactivity > 0 ? formatDuration(inactivity) : 'Off') : '…',
      hint: 'How long of silence before your heir can start inheriting.',
      type: 'duration',
    },
    {
      kind: KIND.SetInstantLimit,
      label: 'Instant limit',
      value: configReady && instantLimit !== undefined ? `${formatMon(instantLimit)} MON` : '…',
      hint: 'How much you can cash out instantly per day. Raising it is time-locked; lowering is instant.',
      type: 'amount',
    },
  ];

  return (
    <div>
      {frozen && (
        <div className="safety-banner" data-tone="warning">
          <LockIcon size={17} />
          <div style={{ fontSize: 13.5, fontWeight: 550 }}>
            Your vault is frozen. No money can leave until you unfreeze it.
          </div>
        </div>
      )}

      {hasPending && (
        <div className="safety-banner" data-tone="warning">
          <ClockIcon size={17} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{KIND_LABEL[pKind]} change pending</div>
            <div style={{ fontSize: 12.5, opacity: 0.85 }}>
              {pMatured ? 'Ready to apply.' : `Applies in ${formatDuration(pExecuteAfter - now)}. Cancel it any time.`}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => simpleWrite('cancelChange', 'cancel')}>
            {busyLabel === 'cancel' ? <span className="spinner-sm" /> : 'Cancel'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !pMatured || !configReady}
            onClick={() => simpleWrite('executeChange', 'apply')}
          >
            {busyLabel === 'apply' ? <span className="spinner-sm" /> : 'Apply'}
          </button>
        </div>
      )}

      <div className="safety-section-label">Guardians &amp; limits</div>
      <div className="card card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {rows.map((row) => (
          <div key={row.kind}>
            <div className="set-row">
              <div>
                <div className="set-label">{row.label}</div>
                <div className="set-value mono">{row.value}</div>
                <div className="set-hint">{row.hint}</div>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy || hasPending || editing !== null || !configReady}
                onClick={() => openEdit(row.kind)}
              >
                {row.value === 'Not set' || row.value === 'Off' || row.value === '—' ? 'Set' : 'Change'}
              </button>
            </div>
            {editing === row.kind && (
              <div className="set-edit">
                <input
                  className={`field ${row.type === 'address' ? 'field-mono' : ''}`}
                  placeholder={
                    row.type === 'address' ? '0x…' : row.type === 'duration' ? 'seconds, e.g. 604800' : 'MON, e.g. 0.05'
                  }
                  inputMode={row.type === 'address' ? 'text' : 'decimal'}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value.trim())}
                  disabled={busy}
                  autoFocus
                />
                {row.type === 'duration' &&
                  /^\d+$/.test(editValue) &&
                  Number(editValue) > 0 &&
                  Number(editValue) <= 315_360_000 && (
                    <div className="set-hint" style={{ marginTop: 6 }}>
                      = {formatDuration(Number(editValue))}
                    </div>
                  )}
                {editError && (
                  <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 7 }}>{editError}</div>
                )}
                <div className="row gap-2" style={{ marginTop: 10 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy || !configReady || hasPending}
                    onClick={() => saveEdit(row.kind, row.type)}
                  >
                    {busyLabel === KIND_LABEL[row.kind] ? <span className="spinner-sm" /> : 'Save'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setEditError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="safety-section-label">Emergency</div>
      <div className="card card-pad stack gap-3">
        {frozen ? (
          <EmergencyRow
            title="Unfreeze"
            desc="Re-enable money leaving your vault. Time-locked, so a stolen key can't instantly re-open it."
            action={
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy || hasPending || !configReady}
                onClick={() => requestChange(KIND.Unfreeze, ZERO, 0n, 'Unfreeze')}
              >
                {busyLabel === 'Unfreeze' ? <span className="spinner-sm" /> : 'Unfreeze'}
              </button>
            }
          />
        ) : (
          <EmergencyRow
            title="Panic freeze"
            desc="Instantly stop all money leaving your vault. Reversible with a time-locked unfreeze."
            action={
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || !configReady}
                onClick={() => simpleWrite('panic', 'panic')}
              >
                {busyLabel === 'panic' ? <span className="spinner-sm" /> : 'Freeze'}
              </button>
            }
          />
        )}

        <EmergencyRow
          title="Check in"
          desc="Prove you're here. Resets your inactivity clock and cancels any inheritance in progress."
          action={
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => simpleWrite('checkIn', 'checkin')}>
              {busyLabel === 'checkin' ? <span className="spinner-sm" /> : 'Check in'}
            </button>
          }
        />

        <EmergencyRow
          title="Kill switch"
          desc={
            !configReady
              ? 'Loading your settings…'
              : !hasSafe
                ? 'Set a safe address first. Then this sweeps everything there and freezes the vault.'
                : !safeMatured
                  ? `Sweeps everything to your safe address and freezes the vault. Your safe address matures in ${cfgDelay !== undefined && now > 0 ? formatDuration(safeSetAt + cfgDelay - now) : '…'}.`
                  : `Sweeps everything to ${shortAddress(safe)} and freezes the vault.`
          }
          action={
            killConfirm && safeMatured && configReady ? (
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || !configReady || !safeMatured}
                onClick={killSwitch}
              >
                {busyLabel === 'kill' ? <span className="spinner-sm" /> : 'Confirm sweep'}
              </button>
            ) : (
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || !safeMatured || !configReady}
                onClick={() => setKillConfirm(true)}
              >
                Kill switch
              </button>
            )
          }
        />
      </div>

      <div className="row gap-2" style={{ marginTop: 16, color: 'var(--text-faint)', fontSize: 12 }}>
        <ShieldIcon size={13} />
        Powerful changes are time-locked and cancellable. Protective freezes are instant.
      </div>
    </div>
  );
}

function EmergencyRow({ title, desc, action }: { title: string; desc: string; action: React.ReactNode }) {
  return (
    <div className="row between gap-3" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div className="set-label">{title}</div>
        <div className="set-hint" style={{ maxWidth: 300 }}>
          {desc}
        </div>
      </div>
      {action}
    </div>
  );
}
