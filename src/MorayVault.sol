// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MorayVault
/// @notice Moray — the self-custodial safe. Funds live inside your own vault
///         balance in this shared, multi-tenant contract. "You" are the address
///         that owns your sub-account (a Privy secp256k1 EOA in the app). Every
///         security control below is keyed per-user, so one deployment serves
///         everyone without any of them being able to touch each other's funds.
///
///         The core promise: money-out is bank-style rate-limited. Small cash-out
///         up to your per-24h `instantLimit` is instant; anything above the
///         remaining allowance (and, by default on a fresh account, everything —
///         the limit starts at 0) becomes a delayed, recallable, freezable exit.
///         Raising the allowance is itself timelocked; lowering it is instant.
///         Sends obey the SAME policy: a send within the remaining allowance to a
///         cleared payee is instant (and spends the allowance), but any amount
///         above the allowance, or to a never-cleared payee, is held for a delay
///         and is recallable/freezable — so `send` cannot be used to dodge the
///         withdrawal limit. Even the kill switch is not an instant full drain:
///         it pays exactly ONE place, your own pre-committed safe address, and
///         only once that address has matured (`configDelay` after being set;
///         it is instant-settable only while the vault is empty, otherwise
///         timelocked). So NO fund-redirecting action is instant, and a thief who
///         steals your live signer can move at most your small allowance per day
///         instantly, never the whole vault at once.
///
///         Moray closes the three ways people lose crypto:
///           1. Bad / scam send  -> recallable clearing window + new-payee floor.
///           2. Drained by a thief who has your signer -> instant cash-out is
///              capped at a small per-day allowance; larger exits are freezable,
///              recallable pending actions; panic freeze (instant) + kill switch
///              that sweeps to a pre-committed safe address, both of which a
///              recovery contact can trigger out-of-band.
///           3. Lost keys / you're gone -> Dead Man's Switch to a designated heir.
///
///         The load-bearing invariant:
///           Every powerful (control- or fund-redirecting) change is DELAYED and
///           CANCELLABLE by the current owner. Recovery is a "silent-owner
///           fallback", never "delayed theft". Protective actions that only STOP
///           money leaving (panic / freeze) are INSTANT; actions that re-enable
///           or redirect egress are delayed and owner-vetoable.
///
///         Delegated powers can never redirect funds to a helper's chosen
///         address: a recovery contact can only freeze you or sweep to YOUR own
///         pre-committed safe address; an heir can only inherit after you have
///         gone silent through an inactivity period AND a veto window you can
///         cancel at any point by simply using your vault.
///
///         Solvency invariant: the contract always holds AT LEAST what it owes,
///           address(this).balance >= sum(balanceOf) + sum(pending amounts).
///         (Forced native value via selfdestruct/coinbase can only make the
///         contract balance larger; it is unaccounted dust, never withdrawable
///         by anyone, so it never threatens user funds.)
///
///         Honest limit (stated, not hidden): a signer compromised for longer
///         than the relevant delay, with the owner never reacting to alerts, can
///         still drain the small instant allowance each window, push a delayed
///         withdrawal and wait it out, or reconfigure the safe address and sweep.
///         On-chain delays and the per-day cap buy reaction time and bound the
///         instant loss; they are not unbreakable. This is still strictly safer
///         than a plain wallet, where a stolen key is an instant, total,
///         irreversible drain.
contract MorayVault {
    // --------------------------------------------------------------------- //
    //                                Types                                   //
    // --------------------------------------------------------------------- //

    enum Status {
        Pending,
        Cancelled,
        Claimed
    }

    struct Transfer {
        address from;
        address to; // to == from denotes a withdrawal back to the owner
        uint256 amount;
        uint64 unlockTime;
        Status status;
    }

    /// @notice Per-user security configuration. All zero by default (unset).
    struct Account {
        address safeAddress; // kill-switch destination: the owner's cold wallet
        address recoveryContact; // out-of-band party: may freeze or trigger a sweep
        address heir; // Dead Man's Switch beneficiary
        uint64 inactivityPeriod; // silence before the heir may start inheriting (0 = off)
        uint64 lastActivity; // last owner-authenticated action (proof of life)
        bool frozen; // panic freeze: blocks all money-out
        uint256 instantLimit; // instant cash-out allowance per INSTANT_WINDOW (0 = all delayed)
        uint64 instantWindowStart; // start of the current instant-allowance window
        uint256 instantSpent; // instant amount already used in the current window
        uint64 safeSetAt; // when safeAddress was last set (killSwitch requires it aged by configDelay)
    }

    /// @notice The kinds of powerful change routed through the timelock.
    enum ChangeKind {
        None,
        SetSafe,
        SetRecovery,
        SetHeir,
        SetInactivity,
        SetInstantLimit,
        Unfreeze
    }

    /// @notice A single pending timelocked change per user (one slot).
    struct PendingChange {
        ChangeKind kind;
        address addr;
        uint256 num;
        uint64 executeAfter;
    }

    /// @notice A pending, owner-vetoable inheritance started by the heir.
    struct Inheritance {
        bool active;
        uint64 executeAfter;
    }

    // --------------------------------------------------------------------- //
    //                                State                                   //
    // --------------------------------------------------------------------- //

    /// @notice Spendable, withdrawable vault balance per user (funds not in flight).
    mapping(address => uint256) public balanceOf;

    /// @notice All transfers ever created, by id.
    mapping(uint256 => Transfer) public transfers;

    /// @notice Has `from` ever had a transfer to `to` successfully clear?
    ///         True = trusted payee, future sends may clear instantly. Revocable
    ///         by the owner via `untrust`.
    mapping(address => mapping(address => bool)) public cleared;

    /// @notice Per-user security configuration.
    mapping(address => Account) public accounts;

    /// @notice Per-user pending timelocked change (one at a time).
    mapping(address => PendingChange) public pendingChange;

    /// @notice Per-user pending inheritance.
    mapping(address => Inheritance) public inheritance;

    uint256 public nextTransferId;

    /// @notice Active (still-Pending) transfer ids per sender, for bounded sweeps.
    mapping(address => uint256[]) private _activePending;
    /// @notice transfer id => (index in its sender's _activePending array) + 1. 0 = absent.
    mapping(uint256 => uint256) private _pendingIndex;

    /// @notice Cap on simultaneous pending items (sends + withdrawals) per user so
    ///         kill-switch / inheritance sweeps iterate a bounded set (no
    ///         gas-griefing DoS).
    uint256 public constant MAX_ACTIVE_PENDING = 16;

    /// @notice Rolling (tumbling) window over which the instant withdrawal
    ///         allowance is measured and refills.
    uint64 public constant INSTANT_WINDOW = 1 days;

    /// @notice Upper bound on every constructor delay, so `block.timestamp + delay`
    ///         can never approach uint64 overflow (defensive; sane values are
    ///         seconds-to-hours).
    uint64 public constant MAX_DELAY = 365 days;

    /// @notice Minimum clearing window forced on any never-before-cleared payee.
    uint64 public immutable minNewPayeeDelay;
    /// @notice Delay for powerful config changes and for unfreeze.
    uint64 public immutable configDelay;
    /// @notice Veto window after the heir starts inheriting, during which any
    ///         sign of life from the owner cancels it.
    uint64 public immutable inheritanceVetoDelay;
    /// @notice Clearing window for a withdrawal back to the owner's own wallet.
    uint64 public immutable withdrawDelay;
    /// @notice Grace period AFTER a transfer unlocks during which only the
    ///         recipient may claim; once it elapses on an unclaimed transfer the
    ///         sender may `reclaim` the funds (anti-wedge for recipients that
    ///         cannot receive native value).
    uint64 public immutable reclaimGrace;

    bool private _entered;

    // --------------------------------------------------------------------- //
    //                                Events                                  //
    // --------------------------------------------------------------------- //

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount); // instant cash-out
    event WithdrawRequested(uint256 indexed id, address indexed user, uint256 amount, uint64 unlockTime);
    event TransferCreated(
        uint256 indexed id, address indexed from, address indexed to, uint256 amount, uint64 unlockTime
    );
    event TransferCancelled(uint256 indexed id);
    event TransferReclaimed(uint256 indexed id);
    event TransferClaimed(uint256 indexed id, address indexed to, uint256 amount);
    event Untrusted(address indexed user, address indexed payee);

    event ChangeRequested(address indexed user, ChangeKind kind, address addr, uint256 num, uint64 executeAfter);
    event ChangeCancelled(address indexed user, ChangeKind kind);
    event ConfigChanged(address indexed user, ChangeKind kind, address addr, uint256 num);

    event Frozen(address indexed user, address indexed by);
    event Unfrozen(address indexed user);
    event KillSwitchTriggered(address indexed user, address indexed to, uint256 amount);

    event CheckedIn(address indexed user, uint64 at);
    event InheritanceStarted(address indexed user, address indexed heir, uint64 executeAfter);
    event InheritanceCancelled(address indexed user);
    event InheritanceExecuted(address indexed user, address indexed heir, uint256 amount);

    // --------------------------------------------------------------------- //
    //                              Modifiers                                 //
    // --------------------------------------------------------------------- //

    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        uint64 _minNewPayeeDelay,
        uint64 _configDelay,
        uint64 _inheritanceVetoDelay,
        uint64 _withdrawDelay,
        uint64 _reclaimGrace
    ) {
        require(
            _minNewPayeeDelay <= MAX_DELAY && _configDelay <= MAX_DELAY && _inheritanceVetoDelay <= MAX_DELAY
                && _withdrawDelay <= MAX_DELAY && _reclaimGrace <= MAX_DELAY,
            "delay too large"
        );
        minNewPayeeDelay = _minNewPayeeDelay;
        configDelay = _configDelay;
        inheritanceVetoDelay = _inheritanceVetoDelay;
        withdrawDelay = _withdrawDelay;
        reclaimGrace = _reclaimGrace;
    }

    // --------------------------------------------------------------------- //
    //                          Funding & core sends                         //
    // --------------------------------------------------------------------- //

    /// @notice Fund your vault by sending native value directly to the contract.
    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        _alive(msg.sender);
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Fund your vault balance.
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        _alive(msg.sender);
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw to your own wallet. Bank-style: if `amount` fits within
    ///         your remaining per-window instant allowance it pays out
    ///         immediately; otherwise it becomes a delayed exit that enters the
    ///         `withdrawDelay` clearing window (recallable via `cancel`, freezable,
    ///         released by `claim`). A fresh account has a 0 allowance, so
    ///         everything is delayed until you deliberately raise it. Frozen
    ///         accounts get no instant path.
    /// @return id The delayed exit's transfer id (meaningless when `instant`).
    /// @return instant True if it paid out immediately.
    function withdraw(uint256 amount) external nonReentrant returns (uint256 id, bool instant) {
        require(!accounts[msg.sender].frozen, "frozen");
        require(amount > 0, "zero");
        require(balanceOf[msg.sender] >= amount, "insufficient");

        if (amount <= _remainingInstant(msg.sender)) {
            balanceOf[msg.sender] -= amount;
            _spendInstant(msg.sender, amount);
            _alive(msg.sender);
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "send fail");
            emit Withdrawn(msg.sender, amount);
            return (0, true);
        }

        // Delayed exit (to == from denotes a withdrawal).
        require(_activePending[msg.sender].length < MAX_ACTIVE_PENDING, "too many pending");
        balanceOf[msg.sender] -= amount;
        id = nextTransferId++;
        uint64 unlockTime = uint64(block.timestamp) + withdrawDelay;
        transfers[id] =
            Transfer({from: msg.sender, to: msg.sender, amount: amount, unlockTime: unlockTime, status: Status.Pending});
        _addPending(msg.sender, id);
        _alive(msg.sender);
        emit WithdrawRequested(id, msg.sender, amount, unlockTime);
        return (id, false);
    }

    /// @notice Instant allowance still available to `user` this window.
    function remainingInstantAllowance(address user) external view returns (uint256) {
        return _remainingInstant(user);
    }

    /// @notice Send from your vault balance through a clearing window. Egress is
    ///         governed by the SAME policy as `withdraw`, so `send` cannot be used
    ///         to dodge the withdrawal limits:
    ///           - a never-cleared payee gets at least `minNewPayeeDelay`
    ///             (anti-mistake hold);
    ///           - any amount above your remaining instant allowance gets at least
    ///             `withdrawDelay` (anti-drain hold);
    ///           - the final delay is the max of those and your `requestedDelay`.
    ///         A send that ends up instant (delay 0 — only possible to a cleared
    ///         payee for an amount within your allowance) consumes the instant
    ///         allowance, exactly like an instant withdrawal. So a stolen signer
    ///         can move at most your per-window allowance instantly, via send or
    ///         withdraw alike.
    /// @return id The new transfer id.
    function send(address to, uint256 amount, uint64 requestedDelay) external returns (uint256 id) {
        require(!accounts[msg.sender].frozen, "frozen");
        require(to != address(0), "zero to");
        require(to != msg.sender, "self"); // use withdraw to pay yourself
        require(amount > 0, "zero");
        require(balanceOf[msg.sender] >= amount, "insufficient");
        require(_activePending[msg.sender].length < MAX_ACTIVE_PENDING, "too many pending");

        uint64 delay = requestedDelay;
        if (!cleared[msg.sender][to]) {
            delay = _max64(delay, minNewPayeeDelay); // anti-mistake hold for a new payee
        }
        if (amount > _remainingInstant(msg.sender)) {
            delay = _max64(delay, withdrawDelay); // anti-drain hold for a large exit
        }

        balanceOf[msg.sender] -= amount;
        if (delay == 0) {
            _spendInstant(msg.sender, amount); // instant egress consumes the allowance
        }
        id = nextTransferId++;
        uint64 unlockTime = uint64(block.timestamp) + delay;
        transfers[id] =
            Transfer({from: msg.sender, to: to, amount: amount, unlockTime: unlockTime, status: Status.Pending});
        _addPending(msg.sender, id);
        _alive(msg.sender);
        emit TransferCreated(id, msg.sender, to, amount, unlockTime);
    }

    /// @notice Recall a pending transfer/withdrawal before its window closes.
    ///         Funds return to your vault balance. Only the sender, only while
    ///         still clearing.
    function cancel(uint256 id) external {
        Transfer storage t = transfers[id];
        require(t.status == Status.Pending, "not pending");
        require(t.from == msg.sender, "not sender");
        require(block.timestamp < t.unlockTime, "window closed");
        t.status = Status.Cancelled;
        balanceOf[msg.sender] += t.amount;
        _removePending(msg.sender, id);
        _alive(msg.sender);
        emit TransferCancelled(id);
    }

    /// @notice Reclaim a transfer that unlocked but was never claimed, once the
    ///         recipient's grace period has passed. This exists so a recipient
    ///         that cannot receive native value (a reverting contract) can never
    ///         permanently wedge your funds or your pending slots. During
    ///         [unlockTime, unlockTime + reclaimGrace] only the recipient may
    ///         claim, preserving payment finality; after that the sender may pull
    ///         the funds back into their vault balance.
    function reclaim(uint256 id) external {
        Transfer storage t = transfers[id];
        require(t.status == Status.Pending, "not pending");
        require(t.from == msg.sender, "not sender");
        require(block.timestamp >= t.unlockTime + reclaimGrace, "grace not passed");
        t.status = Status.Cancelled;
        balanceOf[msg.sender] += t.amount;
        _removePending(msg.sender, id);
        _alive(msg.sender);
        emit TransferReclaimed(id);
    }

    /// @notice Release a cleared transfer to its recipient (or a matured
    ///         withdrawal to its owner). Permissionless once the window has passed
    ///         (recipient or a relayer can trigger it). Blocked while the sender's
    ///         account is frozen. Marks a real payee "cleared" so future sends to
    ///         them can be instant. If the owner claims their own transfer, that
    ///         counts as a sign of life.
    function claim(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        require(t.status == Status.Pending, "not pending");
        require(!accounts[t.from].frozen, "sender frozen");
        require(block.timestamp >= t.unlockTime, "still clearing");
        t.status = Status.Claimed;
        if (t.to != t.from) {
            cleared[t.from][t.to] = true;
        }
        _removePending(t.from, id);
        // Only the owner claiming their OWN transfer proves life; a third-party
        // (recipient/relayer) claim must NOT refresh the owner's activity clock.
        if (msg.sender == t.from) {
            _alive(t.from);
        }
        (bool ok,) = t.to.call{value: t.amount}("");
        require(ok, "send fail");
        emit TransferClaimed(id, t.to, t.amount);
    }

    /// @notice Revoke a payee's trusted status; future sends to them are forced
    ///         back through the new-payee clearing window.
    function untrust(address payee) external {
        cleared[msg.sender][payee] = false;
        _alive(msg.sender);
        emit Untrusted(msg.sender, payee);
    }

    // --------------------------------------------------------------------- //
    //                     Panic freeze  (protective, instant)               //
    // --------------------------------------------------------------------- //

    /// @notice Instantly freeze your own account: no withdraw, no send, no claim
    ///         of your pending transfers. Purely protective (never moves money),
    ///         so it is instant. Re-enabling egress (`unfreeze`) is delayed.
    ///         Counts as a sign of life (cancels any pending inheritance).
    function panic() external {
        _alive(msg.sender);
        _freeze(msg.sender, msg.sender);
    }

    /// @notice Your designated recovery contact can freeze your account
    ///         out-of-band (e.g. you tell them your phone was stolen). Still
    ///         purely protective: freezing can never move your money anywhere.
    ///         Does NOT count as owner life (a recovery contact acting is not
    ///         proof the owner is alive).
    function freeze(address user) external {
        require(msg.sender == accounts[user].recoveryContact, "not recovery");
        _freeze(user, msg.sender);
    }

    function _freeze(address user, address by) internal {
        require(!accounts[user].frozen, "already frozen");
        accounts[user].frozen = true;
        emit Frozen(user, by);
    }

    // --------------------------------------------------------------------- //
    //                    Kill switch  (sweep to safe address)               //
    // --------------------------------------------------------------------- //

    /// @notice Sweep the entire account (balance + every pending item, which are
    ///         cancelled and reclaimed) to the pre-committed safe address, then
    ///         leave the account frozen. Callable by the owner OR the recovery
    ///         contact. It can ONLY ever pay the owner's own `safeAddress`, so a
    ///         malicious recovery contact can move funds to the owner's cold wallet
    ///         but can never steal.
    ///
    ///         The safe address must have MATURED: it can only be used by
    ///         killSwitch once `configDelay` has passed since it was set. This is
    ///         the last piece that makes NO fund-redirecting action in this
    ///         contract instant. It blocks the opportunistic pre-position attack
    ///         (a stolen signer setting safe=attacker on an empty vault and
    ///         sweeping in the same session).
    ///
    ///         Honest residual (documented, not hidden): a PATIENT attacker who
    ///         controls the signer while the vault is empty can set a malicious
    ///         safe, wait out the maturity, then sweep once the owner funds. This
    ///         is the "compromised at setup" hard case: set your safe address and
    ///         fund from a trusted device. Once the vault holds funds, changing the
    ///         safe address is timelocked and owner-vetoable.
    ///
    ///         User-config risk (documented): the safe address MUST be able to
    ///         receive native value (an EOA or a payable contract). If it reverts
    ///         on receipt this call reverts cleanly (no funds lost, account state
    ///         unchanged); the owner recovers by changing the safe address through
    ///         the normal timelocked path and retrying.
    function killSwitch(address user) external nonReentrant {
        require(msg.sender == user || msg.sender == accounts[user].recoveryContact, "not authorized");
        address safe = accounts[user].safeAddress;
        require(safe != address(0), "no safe address");
        require(block.timestamp >= accounts[user].safeSetAt + configDelay, "safe not matured");

        uint256 total = balanceOf[user];
        balanceOf[user] = 0;

        // Reclaim every still-pending item (bounded by MAX_ACTIVE_PENDING).
        uint256[] storage arr = _activePending[user];
        for (uint256 i = arr.length; i > 0; i--) {
            uint256 id = arr[i - 1];
            Transfer storage t = transfers[id];
            if (t.status == Status.Pending) {
                t.status = Status.Cancelled;
                total += t.amount;
                emit TransferCancelled(id);
            }
            _pendingIndex[id] = 0;
            arr.pop();
        }

        accounts[user].frozen = true; // stays frozen after the sweep
        (bool ok,) = safe.call{value: total}("");
        require(ok, "sweep fail");
        emit KillSwitchTriggered(user, safe, total);
    }

    // --------------------------------------------------------------------- //
    //          Timelocked config changes  (safe / recovery / heir …)        //
    // --------------------------------------------------------------------- //

    /// @notice Set or change a piece of security config. The FIRST time a field
    ///         is set (currently unset) it applies instantly; changing an
    ///         already-set field is routed through the `configDelay` timelock so
    ///         the owner can cancel it. Only one pending change at a time.
    /// @param kind  SetSafe | SetRecovery | SetHeir | SetInactivity |
    ///        SetInstantLimit | Unfreeze.
    /// @param addr  New address (for address kinds; must be non-zero).
    /// @param num   New value (SetInactivity seconds, SetInstantLimit wei).
    function requestChange(ChangeKind kind, address addr, uint256 num) external {
        require(kind != ChangeKind.None, "bad kind");
        require(pendingChange[msg.sender].kind == ChangeKind.None, "change pending");
        Account storage a = accounts[msg.sender];

        // Unfreeze is always timelocked (it re-enables egress) and needs no args.
        if (kind == ChangeKind.Unfreeze) {
            require(a.frozen, "not frozen");
        } else if (kind == ChangeKind.SetInactivity) {
            require(num > 0, "zero period");
            require(num <= type(uint64).max, "period too large");
            if (a.inactivityPeriod == 0) {
                _applyChange(msg.sender, kind, addr, num); // instant initial set
                return;
            }
        } else if (kind == ChangeKind.SetInstantLimit) {
            // Tightening (lowering, incl. to 0) is instant; loosening (raising,
            // incl. the first raise from 0) is timelocked so a stolen signer
            // cannot raise-then-drain.
            if (num <= a.instantLimit) {
                _applyChange(msg.sender, kind, addr, num);
                return;
            }
        } else {
            // address kinds
            require(addr != address(0), "zero addr");
            require(addr != msg.sender, "self"); // don't name yourself as recovery/heir/safe helper role
            address current =
                kind == ChangeKind.SetSafe ? a.safeAddress : (kind == ChangeKind.SetRecovery ? a.recoveryContact : a.heir);
            // First set is instant EXCEPT the safe address on a funded account:
            // killSwitch pays the safe address with no delay, so an instant first
            // safe-set on a funded vault would let a stolen signer set safe=attacker
            // then killSwitch to drain instantly. On a funded account the safe
            // address must always go through the timelock (owner-vetoable).
            bool instantOk = current == address(0);
            if (kind == ChangeKind.SetSafe && !_isEmpty(msg.sender)) {
                instantOk = false;
            }
            if (instantOk) {
                _applyChange(msg.sender, kind, addr, num); // instant initial set
                return;
            }
        }

        uint64 executeAfter = uint64(block.timestamp) + configDelay;
        pendingChange[msg.sender] = PendingChange({kind: kind, addr: addr, num: num, executeAfter: executeAfter});
        _alive(msg.sender);
        emit ChangeRequested(msg.sender, kind, addr, num, executeAfter);
    }

    /// @notice Cancel your own pending config change (the owner's veto).
    function cancelChange() external {
        ChangeKind k = pendingChange[msg.sender].kind;
        require(k != ChangeKind.None, "no change");
        delete pendingChange[msg.sender];
        _alive(msg.sender);
        emit ChangeCancelled(msg.sender, k);
    }

    /// @notice Execute your matured pending config change.
    function executeChange() external {
        PendingChange memory p = pendingChange[msg.sender];
        require(p.kind != ChangeKind.None, "no change");
        require(block.timestamp >= p.executeAfter, "not matured");
        delete pendingChange[msg.sender];
        _applyChange(msg.sender, p.kind, p.addr, p.num);
    }

    function _applyChange(address user, ChangeKind kind, address addr, uint256 num) internal {
        Account storage a = accounts[user];
        if (kind == ChangeKind.SetSafe) {
            a.safeAddress = addr;
            a.safeSetAt = uint64(block.timestamp); // start the killSwitch maturity clock
        } else if (kind == ChangeKind.SetRecovery) {
            a.recoveryContact = addr;
        } else if (kind == ChangeKind.SetHeir) {
            a.heir = addr;
        } else if (kind == ChangeKind.SetInactivity) {
            // safe: requestChange enforces num <= type(uint64).max for SetInactivity
            // forge-lint: disable-next-line(unsafe-typecast)
            a.inactivityPeriod = uint64(num);
        } else if (kind == ChangeKind.SetInstantLimit) {
            a.instantLimit = num;
        } else if (kind == ChangeKind.Unfreeze) {
            require(a.frozen, "not frozen");
            a.frozen = false;
            emit Unfrozen(user);
        }
        _alive(user);
        emit ConfigChanged(user, kind, addr, num);
    }

    // --------------------------------------------------------------------- //
    //                    Dead Man's Switch  (heir inheritance)              //
    // --------------------------------------------------------------------- //

    /// @notice Prove you're alive: bump your activity clock and cancel any
    ///         pending inheritance. Any ordinary owner action does this too.
    function checkIn() external {
        _alive(msg.sender);
        emit CheckedIn(msg.sender, uint64(block.timestamp));
    }

    /// @notice The heir starts inheriting after the owner has been inactive for
    ///         `inactivityPeriod`. This opens a veto window; the owner cancels it
    ///         just by using their vault (any action calls `_alive`).
    function startInheritance(address user) external {
        Account storage a = accounts[user];
        require(msg.sender == a.heir, "not heir");
        require(a.inactivityPeriod > 0, "no dms");
        require(a.lastActivity != 0, "never active");
        require(block.timestamp >= a.lastActivity + a.inactivityPeriod, "still active");
        require(!inheritance[user].active, "already started");
        uint64 executeAfter = uint64(block.timestamp) + inheritanceVetoDelay;
        inheritance[user] = Inheritance({active: true, executeAfter: executeAfter});
        emit InheritanceStarted(user, msg.sender, executeAfter);
    }

    /// @notice After the veto window, and only if the owner is still silent and
    ///         the account isn't frozen, the heir sweeps the account to itself.
    ///         User-config risk (documented): like the safe address, the heir must
    ///         be able to receive native value; a reverting heir makes this call
    ///         revert cleanly (no funds lost) until the heir is changed.
    function executeInheritance(address user) external nonReentrant {
        Account storage a = accounts[user];
        Inheritance memory inh = inheritance[user];
        require(inh.active, "no inheritance");
        require(msg.sender == a.heir, "not heir");
        require(!a.frozen, "frozen");
        require(block.timestamp >= inh.executeAfter, "veto window");
        // Owner must still be silent: any activity after the start reopens life.
        require(block.timestamp >= a.lastActivity + a.inactivityPeriod, "owner active");

        delete inheritance[user];

        uint256 total = balanceOf[user];
        balanceOf[user] = 0;
        uint256[] storage arr = _activePending[user];
        for (uint256 i = arr.length; i > 0; i--) {
            uint256 id = arr[i - 1];
            Transfer storage t = transfers[id];
            if (t.status == Status.Pending) {
                t.status = Status.Cancelled;
                total += t.amount;
                emit TransferCancelled(id);
            }
            _pendingIndex[id] = 0;
            arr.pop();
        }

        (bool ok,) = a.heir.call{value: total}("");
        require(ok, "inherit fail");
        emit InheritanceExecuted(user, a.heir, total);
    }

    // --------------------------------------------------------------------- //
    //                          Internal helpers                             //
    // --------------------------------------------------------------------- //

    /// @notice True while the account holds no funds and has no in-flight items.
    ///         Used to gate the instant first-set of the safe address.
    function _isEmpty(address user) internal view returns (bool) {
        return balanceOf[user] == 0 && _activePending[user].length == 0;
    }

    function _max64(uint64 a, uint64 b) internal pure returns (uint64) {
        return a >= b ? a : b;
    }

    /// @notice Instant allowance still available to `user` in the current window.
    ///         A fresh window (or a never-used one) offers the full `instantLimit`.
    function _remainingInstant(address user) internal view returns (uint256) {
        Account storage a = accounts[user];
        uint256 limit = a.instantLimit;
        if (limit == 0) return 0;
        if (uint64(block.timestamp) >= a.instantWindowStart + INSTANT_WINDOW) {
            return limit; // window has rolled over -> full allowance
        }
        uint256 spent = a.instantSpent;
        return spent >= limit ? 0 : limit - spent;
    }

    /// @notice Charge `amount` against the instant allowance, rolling the window
    ///         if it has elapsed. Callers must ensure `amount <= _remainingInstant`.
    function _spendInstant(address user, uint256 amount) internal {
        Account storage a = accounts[user];
        if (uint64(block.timestamp) >= a.instantWindowStart + INSTANT_WINDOW) {
            a.instantWindowStart = uint64(block.timestamp);
            a.instantSpent = amount;
        } else {
            a.instantSpent += amount;
        }
    }

    /// @notice Record proof of life for `user` and cancel any pending inheritance.
    function _alive(address user) internal {
        accounts[user].lastActivity = uint64(block.timestamp);
        if (inheritance[user].active) {
            delete inheritance[user];
            emit InheritanceCancelled(user);
        }
    }

    function _addPending(address user, uint256 id) internal {
        _activePending[user].push(id);
        _pendingIndex[id] = _activePending[user].length; // index + 1
    }

    function _removePending(address user, uint256 id) internal {
        uint256 idxPlus = _pendingIndex[id];
        if (idxPlus == 0) return;
        uint256 idx = idxPlus - 1;
        uint256[] storage arr = _activePending[user];
        uint256 lastIdx = arr.length - 1;
        if (idx != lastIdx) {
            uint256 lastId = arr[lastIdx];
            arr[idx] = lastId;
            _pendingIndex[lastId] = idx + 1;
        }
        arr.pop();
        _pendingIndex[id] = 0;
    }

    // --------------------------------------------------------------------- //
    //                              Views                                     //
    // --------------------------------------------------------------------- //

    /// @notice Number of active (still-pending) sends/withdrawals for a user.
    function activePendingCount(address user) external view returns (uint256) {
        return _activePending[user].length;
    }

    /// @notice The active (still-pending) transfer ids for a user.
    function activePendingIds(address user) external view returns (uint256[] memory) {
        return _activePending[user];
    }
}
