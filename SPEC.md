# Moray — Spec & Resume Checkpoint

_Last updated: session before the morning resume (Monad Spark hackathon build)._

---

## ▶ RESUME HERE (do this first next session)

1. **Build the contract security modules into `MorayVault.sol`** (highest-value,
   most review-worthy, do it fresh):
   - Kill switch: `setSafeAddress` (timelocked change) + `killSwitch()` (sweep
     balance + cancel pendings to the safe address).
   - Dead Man's Switch: `setHeir`, `checkIn`, inactivity → heir can start a
     **delayed, owner-vetoable** withdrawal.
   - Recovery-contact module + the **owner-veto** state machine (see invariant).
   - Instant `panic()` freeze/cancel of pending sends (NOT delayed).
   Then a Foundry test suite that proves each control **denies the bad case**,
   then a Codex adversarial pass.
2. Then scaffold the Next.js + **Privy** frontend (auth + embedded wallet) and
   wire the recipient-risk read.
3. First git commit must land **inside the hackathon window** (see Spark rules).
   Repo is fresh, no commits yet.

---

## What Moray is

**Moray — the self-custodial safe.** Bank-grade protection, you hold the keys.
A focused, self-custodial **smart-contract wallet** for the crypto you can't
afford to lose. No dapp browser, no swaps, no NFT galleries. It does one job
better than anyone: protect the funds inside it.

Positioning (the pitch, not a literal claim): a bank's safety without the bank.
- MetaMask = you control your money, but zero safety (blind/irreversible sends,
  drains, lost keys).
- A bank = safety, but they hold and can freeze your money.
- **Moray = both.** It's safer than MetaMask *because* it's a smart-contract
  wallet (a dumb key can't enforce recall/holds/recovery; a contract can).

**The three ways you lose crypto — Moray closes all three:**
1. Bad/scam send → recallable clearing window + recipient-risk + new-payee hold.
2. Drained by an attacker → kill switch (sweep to safe address).
3. Lost keys / you're gone → Dead Man's Switch heir + on-chain recovery.

Frame it as **the safe for funds you can't afford to lose** (complementary to
MetaMask), NOT "MetaMask killer" (the wallet graveyard — safety alone never
moved anyone; don't oversell to DevRel judges).

---

## Locked scope

**IN (v1):**
- Vault: deposit / withdraw; funds live in the contract (native MON for v1).
- Recallable clearing send; new-payee minimum window **enforced on-chain**.
- Beneficiaries: **names/notes off-chain & private** (local for v1); the on-chain
  `cleared[from][to]` flag is the trust half → trusted payee can clear instantly.
- Recipient-risk screen: off-chain read (age, tx count, flagged links, poisoning
  lookalike) → a plain-English verdict that **sizes the clearing window** and
  justifies it. Show a verdict, not a raw tx dump.
- Kill switch (setSafeAddress timelocked + killSwitch sweep).
- Dead Man's Switch (heir + check-in + delayed vetoable inheritance).
- Panic freeze (instant).
- Statement view: reads contract events + local beneficiary labels. "What" =
  spend-by-beneficiary + optional user tags. **No fake auto-categorization.**

**OUT (roadmap, v2):**
- Yield (Morpho) — dependency + mainnet + neobank-crowding. Cut.
- Loans — breaks one-feature focus, most-crowded DeFi, poisons safety identity.
- Subscriptions / recurring payments / approval management.
- CCTP / cross-chain sending — architecturally conflicts with recall (can't
  recall a burn); single-chain on Monad only.
- ERC20 / stablecoin (USD1) support — reasonable near-term, but v1 is native MON.
- Full guardian-based signer key-rotation social recovery.
- Encrypted portable beneficiary sync (names off-device without doxxing).

---

## Security architecture (LOCKED)

**Signer / auth: Privy embedded wallet.** Email/passkey login, no seed phrase,
no operator custody (TEE + Shamir's Secret Sharing — no single party incl. Privy
holds the full key). Hands each user a secp256k1 EOA → contract verifies normal
EVM signatures (**no P-256 precompile dependency**). Privy officially supports
Monad and **subsidizes all Monad testnet usage**; official `monad-developers`
Privy example repos exist. (Caveat noted: Privy's SSS reconstructs the key inside
the TEE at signing time; non-custodial and fine for our model.)

**Hard rules:**
- Server **never** generates/sees/stores/reconstructs a full user key. Any
  recovery path that routes through the operator = custodial = rejected.
- **Email is an identifier + alert channel ONLY.** It must NEVER be able to add
  or rotate a signer. Signer rotation requires the existing signer or the
  on-chain recovery flow. (Else email takeover = wallet takeover.)
- Recovery is cryptographic (Privy re-auth) or on-chain (safe address / recovery
  contact / heir), never "come to us to prove ownership."
- Fail-closed everywhere; no fallback/placeholder security.

**The load-bearing invariant:**
> **Every powerful (control- or fund-redirecting) change is DELAYED and
> CANCELLABLE by the current owner.** Recovery = "silent-owner fallback," not
> "delayed theft."

Applies to: change safe address, add/remove recovery contact, rotate signer,
inactivity (Dead Man) withdrawal, emergency recovery.
Flow: initiator starts → wallet enters `RecoveryPending` → owner has the full
delay to cancel with the current signer → executes only if the owner stays
silent.

**The three refinements that make the veto real (must build in):**
1. **Notification is load-bearing.** The veto only works if the owner *knows*.
   Every pending delay must alert the owner, and NOT solely by email (an attacker
   controlling email can suppress it). Delay long enough to survive a missed
   alert.
2. **Protective vs powerful.** Delay applies to control/fund-redirecting changes.
   **Panic freeze is INSTANT** (it only stops money leaving, never redirects it).
3. **Per-action delays + gated initiation.** Different delays per action; only
   the *designated* recovery contact/safe address may initiate; rate-limit
   initiations (anti veto-fatigue). Initial setup is instant (only *changes* are
   delayed).
   Honest limit: a fully compromised *live* signer (passkey/device, not email) is
   the hard case — delays buy reaction time; panic + recovery-contact mitigate;
   still far better than a normal wallet (compromised key = instant total drain).
   Don't oversell as unbreakable.

Contract-security checklist to apply (from `references/web3-evm.md`): reentrancy
(guarded), access control on every setter, no unprotected init, safe external
calls, no unbounded panic loop (cap or track pending ids), events for the
statement/audit trail. Adversarial Codex pass on every contract commit.

---

## What's built vs to-build

**Built:** `src/MorayVault.sol` — P0 core: deposit/withdraw, `send` with on-chain
new-payee min-delay enforcement, `cancel` (recall), `claim` (pays recipient +
sets `cleared` trust), reentrancy guard, full events. Complete demo on its own.
`foundry.toml` present. **No tests yet. No git commit yet.**

**To build (priority):**
- P0 tests (Foundry) — prove new-payee hold, recall refund, claim pays + trusts,
  cleared payee instant.
- Security modules: kill switch, Dead Man's Switch, recovery/veto/delay, panic.
- Frontend: Next.js + Privy, send flow w/ recipient-risk verdict + countdown,
  pending/recall, beneficiaries (local names), safety (safe addr / panic / kill),
  statement.
- Deploy to Monad testnet; wire contract address; 3-min demo video; public repo.

---

## Stack
Foundry + Solidity (native MON, v1) · Next.js + wagmi/viem · **Privy** (auth +
embedded wallet) · Monad **testnet** (self-contained, real data, no external
dependency now that yield is cut).

## Spark constraints (judging)
- Window: **Jul 13 1PM UTC → Jul 19 11:59PM UTC.** Fresh repo, all commits
  in-window, no pre-built code. Judges: 2 Monad DevRels (Harpalsinh Jadeja, Kacie
  Ahmed) + an AI agent (checks live-vs-placeholder data, commit authenticity).
- Penalized: AI-slop UI, tutorial clones, mystery-box (no README/video/setup),
  vaporware (hardcoded data, fake toasts, many fake features > one real one).
- Rewarded: **practical, solves a real problem YOU have** (mandatory), one real
  working feature, distinct identity, clean 3-min demo. Prizes: 3× $500 elegant +
  1× $500 viral.
- Deliverables: name, problem, solution, live URL, public GitHub, Monad contract
  address, <3min demo video, optional social post (viral prize).

## Naming
Brand: **Moray** (plain). Tagline: *the self-custodial safe.* Contract:
`MorayVault`. Repo/folder: `moray`.
