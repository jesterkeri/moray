'use client';

import { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { useAccount } from 'wagmi';
import { shortAddress } from '@/lib/moray';
import { MAX_NAME_LEN } from '@/lib/beneficiaries';
import { useBeneficiaries } from '@/lib/useBeneficiaries';
import { BookmarkIcon, TrashIcon, PlusIcon } from './icons';

export function BeneficiariesScreen() {
  const { address } = useAccount();
  const { list, add, remove } = useBeneficiaries();

  const [addr, setAddr] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // On account switch, clear the form and any armed remove so it can't act on
  // the previous account's list.
  useEffect(() => {
    setAddr('');
    setName('');
    setError(null);
    setConfirmRemove(null);
  }, [address]);

  const canAdd = isAddress(addr.trim()) && name.trim().length > 0;

  function submit() {
    setError(null);
    const res = add(addr, name);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAddr('');
    setName('');
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
        Save the people and services you pay, and name them. When you send, Moray
        recognizes a saved payee and hard-flags any address dressed up to look
        like one. Saved on this device, never on-chain. Naming a payee never
        shortens a hold: a new address still clears through its window.
      </p>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Address</label>
          <input
            className="field field-mono"
            placeholder="0x…"
            value={addr}
            onChange={(e) => setAddr(e.target.value.trim())}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="field"
            placeholder="e.g. Mom, Landlord, Coinbase"
            value={name}
            maxLength={MAX_NAME_LEN}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>
        )}
        <button
          className="btn btn-primary btn-block"
          style={{ height: 46 }}
          disabled={!canAdd}
          onClick={submit}
        >
          <PlusIcon size={16} /> Save beneficiary
        </button>
      </div>

      {list.length === 0 ? (
        <div className="beneficiary-empty">
          <BookmarkIcon size={20} />
          <div>
            No saved beneficiaries yet. Add the addresses you trust so a lookalike
            can never slip past you.
          </div>
        </div>
      ) : (
        <div className="card card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {list.map((b) => (
            <div className="set-row" key={b.address}>
              <div style={{ minWidth: 0 }}>
                <div className="set-label">{b.name}</div>
                <div className="set-value mono">{shortAddress(b.address)}</div>
              </div>
              {confirmRemove === b.address ? (
                <div className="row gap-2">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      remove(b.address);
                      setConfirmRemove(null);
                    }}
                  >
                    Remove
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Remove ${b.name}`}
                  onClick={() => setConfirmRemove(b.address)}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row gap-2" style={{ marginTop: 16, color: 'var(--text-faint)', fontSize: 12 }}>
        <BookmarkIcon size={13} />
        Names are a personal label on your device. The safety window is enforced
        on-chain, whatever the name says.
      </div>
    </div>
  );
}
