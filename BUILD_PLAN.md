# Moray — Build Plan

_The day-by-day plan for the Monad Spark hackathon build. Companion to
`SPEC.md` (the locked design/decisions) and `MorayVault.sol` (the contract).
Read SPEC.md first for **what** and **why**; this file is **when** and **in
what order**._

## Clock & non-negotiables

- **Window:** Jul 13 1PM UTC → **Jul 19 11:59PM UTC**. Today is **Jul 15** —
  ~4.5 effective days left.
- **Fresh repo, every commit in-window.** Repo is not git-initialized yet; the
  very first commit must land after Jul 13 1PM UTC (it will). No pre-window code.
- **An AI judge checks live-vs-placeholder.** Everything demoed must run against
  the real deployed contract on Monad testnet with real data. No hardcoded
  balances, no fake toasts, no vaporware features. One real feature > five fake.
- **Codex adversarial pass on every contract commit** (and on follow-up fixes),
  before it's considered done. I draft the prompt; Joshua runs Codex; I triage,
  not rubber-stamp. Tests land before the Codex pass so it reviews proof, not prose.
- **Security invariant (from SPEC):** every powerful/redirecting change is delayed
  + owner-cancellable; protective freezes are instant; delegates can never
  redirect funds to their own address. The tests must _prove the bad case is
  denied_, not just that the happy path works.

## Current state (Jul 15, morning)

- ✅ `MorayVault.sol` — P0 core (deposit/withdraw/recallable send/new-payee
  floor/recall/claim) **+ all security modules** (panic freeze, recovery-contact
  freeze, kill switch → safe address, timelocked config state machine with
  instant-first-set, Dead Man's Switch with vetoable inheritance, bounded
  pending-set sweeps). Compiles clean on solc 0.8.24.
- ✅ `foundry.toml`, `SPEC.md`.
- ❌ No tests. ❌ No git. ❌ No deployment. ❌ No frontend. ❌ No forge-std.

---

## Day 1 — Jul 15 (today): lock the hero (contract + tests + deploy)

The contract is the most review-worthy, highest-risk artifact and the thing the
AI judge and Codex will hit hardest. Get it bulletproof and on-chain today.

1. **Repo init.** `git init`, `.gitignore` (out/, cache/, broadcast/, node_modules/,
   .env*), `forge install foundry-rs/forge-std`. First in-window commit: the
   contract + scaffold.
2. **Foundry test suite** (`test/MorayVault.t.sol`) — one assertion per control
   that the **bad case reverts**:
   - New-payee floor raises the window; cleared payee sends instantly.
   - Recall refunds before unlock; cannot recall after unlock; non-sender cannot recall.
   - Claim pays after window; reverts before; reverts while sender frozen; sets `cleared`.
   - `panic` / recovery-contact `freeze` block withdraw+send+claim; non-recovery cannot freeze.
   - `unfreeze` is timelocked; cannot unfreeze instantly.
   - `killSwitch` sweeps balance + cancels+reclaims pendings → safe address, leaves frozen;
     recovery contact can trigger it; it can ONLY pay `safeAddress`; reverts with no safe set.
   - Config changes: instant on first set, timelocked on change, owner can cancel; cannot
     execute before maturity.
   - Dead Man: heir cannot start before inactivity elapses; `checkIn`/any activity cancels a
     pending inheritance; execute reverts inside veto window, while frozen, or if owner
     became active; heir sweeps only after both delays with owner silent.
   - Reentrancy: malicious recipient/heir/safe cannot re-enter withdraw/claim/killSwitch/inherit.
   - `MAX_ACTIVE_PENDING` cap enforced.
   - Invariant/fuzz: `sum(balanceOf) + sum(pending amounts) == address(this).balance`.
3. **Codex r1** on contract + tests (drafted prompt in `%TEMP%`). Triage → fix → **r2**
   until SHIP. Every fix re-reviewed.
4. **Deploy to Monad testnet** via `forge script` (deploy key from env, never committed).
   Record the contract address in SPEC.md + README. Verify a real deposit/send/recall on-chain.
5. Commit at each green step.

**DoD:** contract deployed on Monad testnet, full suite green, Codex verdict SHIP,
address recorded, one real on-chain round-trip confirmed.

## Day 2 — Jul 16: frontend spine (Privy auth + live wallet + core money-out)

1. Next.js (app router) + wagmi/viem + **Privy** (email/passkey login → embedded
   secp256k1 wallet on Monad testnet). No MetaMask connect flow.
2. Contract client from the deployed ABI/address (env-driven, trimmed + `getAddress()`).
3. Screens against the LIVE contract: fund vault (deposit), balance, withdraw.
4. Send happy path: pick recipient + amount, see the enforced new-payee window, submit.

**DoD:** a freshly-created Privy wallet can deposit, see its real on-chain balance,
and complete a send + recall against the deployed contract. No mocks.

## Day 3 — Jul 17: the differentiators (risk verdict, countdown/recall, beneficiaries)

1. **Recipient-risk read** (off-chain): address age, tx count, poisoning/lookalike
   check → a plain-English verdict that _sizes and justifies_ the clearing window.
   Show a verdict, not a raw tx dump. Fail-closed (unknown → treat as risky/new).
2. **Clearing window UX:** live countdown on pending sends, one-tap **recall**, pending list.
3. **Beneficiaries:** local, private names/notes for addresses (v1 off-chain);
   trusted (cleared) payees clear instantly and are labeled.

**DoD:** sending to a fresh/sketchy address visibly raises the window with a reason;
a pending send counts down and can be recalled; saved payees show names.

## Day 4 — Jul 18: the safe (protection screen + statement) + polish

1. **Safety screen:** set safe address, recovery contact, heir + inactivity (with the
   instant-first / timelocked-change UX and pending-change countdown + cancel);
   **panic** button; **kill switch**; **check-in**. Every powerful action shows its delay.
2. **Statement view:** reads contract events + local beneficiary labels →
   spend-by-payee + optional user tags. No fake auto-categorization.
3. Polish: dual light/dark theme (brand tokens only), empty/loading/error states,
   distinct visual identity (not AI-slop default UI), copy without em-dashes.

**DoD:** a user can configure and exercise every protection on-chain from the UI,
and read an honest statement of where their money went.

## Day 5 — Jul 19: QA, deliverables, ship (with buffer)

1. Full end-to-end QA on live testnet (fresh wallet → fund → risky send → recall →
   configure safety → panic → kill switch sweep → statement).
2. **README:** name, the real problem (Joshua's own), solution, live URL, public
   GitHub, **Monad contract address**, setup steps, security notes/honest limits.
3. **Demo video (<3 min):** clean walkthrough of the one real thing done well.
4. Deploy frontend (Vercel), final env wiring. Optional viral social post.
5. **Submit with buffer** — target done by ~Jul 19 afternoon UTC, not 11:58PM.

**DoD:** all Spark deliverables submitted; live URL + repo + contract address +
video public; a stranger can follow the README and use it.

---

## Deliverables checklist (Spark)

- [ ] Name — **Moray** ✓ (tagline: the self-custodial safe)
- [ ] Problem — a real problem Joshua has (state it plainly in README)
- [ ] Solution — the vault + the three protections
- [ ] Live URL (Vercel)
- [ ] Public GitHub repo (all commits in-window)
- [ ] Monad contract address (testnet)
- [ ] Demo video < 3 min
- [ ] (Optional) social post for the viral prize

## Risk register

- **Privy on Monad testnet auth hiccup** → verify a real login + signed tx on Day 2
  morning before building on it; fall back to Turnkey only if Privy blocks (SPEC notes both).
- **Recipient-risk data source on testnet** → testnet has thin history; design the
  verdict to degrade honestly ("new/unknown address → treated as risky") rather than fake data.
- **Scope creep** → OUT list in SPEC is locked (no yield, loans, ERC20, cross-chain). Say no.
- **Late deploy** → deploy the contract Day 1, not Day 5; frontend points at a stable address all week.
- **Demo against mocks** → banned. Every screen reads/writes the live contract; the AI judge checks.

## Codex review cadence

Contract + tests → r1 → fix → r2 (Day 1). Any later contract change (or a redeploy)
→ its own pass. Frontend security-sensitive bits (env handling, no secret on client,
Privy config, risk-read fail-closed) → a lighter review before submit. Prompts drafted
to `%TEMP%`; Joshua runs Codex; findings triaged CRITICAL/MAJOR/MINOR/NIT, not rubber-stamped.
