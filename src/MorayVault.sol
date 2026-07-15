// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MorayVault
/// @notice Moray — the self-custodial safe. Funds live inside your own vault
///         balance in this shared, multi-tenant contract. "You" are the address
///         that owns your sub-account (a Privy secp256k1 EOA in the app). Every
///         security control below is keyed per-user, so one deployment serves
///         everyone without any of them being able to touch each other's funds.
///
///         Moray closes the three ways people lose crypto:
///           1. Bad / scam send  -> recallable clearing window + new-payee floor.
///           2. Drained by a thief who has your signer -> panic freeze (instant)
///              + kill switch that sweeps to a pre-committed safe address, either
///              of which a recovery contact can trigger out-of-band.
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
///         Honest limit (stated, not hidden): a signer compromised for longer
///         than `configDelay`, with the owner never reacting to alerts, can
///         still reconfigure and drain. On-chain delays buy reaction time; they
///         are not unbreakable. This is still strictly safer than a plain wallet,
///         where a stolen key is an instant, total, irreversible drain.
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
        address to;
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
    }

    /// @notice The kinds of powerful change routed through the timelock.
    enum ChangeKind {
        None,
        SetSafe,
        SetRecovery,
        SetHeir,
        SetInactivity,
        Unfreeze
    }

    /// @notice A single pending timelocked change per user (one slot).
    struct PendingChange {
        ChangeKind kind;
        address addr;
        uint64 num;
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
    ///         True = trusted payee, future sends may clear instantly.
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

    /// @notice Cap on simultaneous pending sends per user so kill-switch /
    ///         inheritance sweeps iterate a bounded set (no gas-griefing DoS).
    uint256 public constant MAX_ACTIVE_PENDING = 16;

    /// @notice Minimum clearing window forced on any never-before-cleared payee.
    uint64 public immutable minNewPayeeDelay;
    /// @notice Delay for powerful config changes and for unfreeze.
    uint64 public immutable configDelay;
    /// @notice Veto window after the heir starts inheriting, during which any
    ///         sign of life from the owner cancels it.
    uint64 public immutable inheritanceVetoDelay;

    bool private _entered;

    // --------------------------------------------------------------------- //
    //                                Events                                  //
    // --------------------------------------------------------------------- //

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event TransferCreated(
        uint256 indexed id, address indexed from, address indexed to, uint256 amount, uint64 unlockTime
    );
    event TransferCancelled(uint256 indexed id);
    event TransferClaimed(uint256 indexed id, address indexed to, uint256 amount);

    event ChangeRequested(address indexed user, ChangeKind kind, address addr, uint64 num, uint64 executeAfter);
    event ChangeCancelled(address indexed user, ChangeKind kind);
    event ConfigChanged(address indexed user, ChangeKind kind, address addr, uint64 num);

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

    constructor(uint64 _minNewPayeeDelay, uint64 _configDelay, uint64 _inheritanceVetoDelay) {
        minNewPayeeDelay = _minNewPayeeDelay;
        configDelay = _configDelay;
        inheritanceVetoDelay = _inheritanceVetoDelay;
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

    /// @notice Pull funds out of your vault back to your own wallet.
    function withdraw(uint256 amount) external nonReentrant {
        require(!accounts[msg.sender].frozen, "frozen");
        require(amount > 0, "zero");
        uint256 bal = balanceOf[msg.sender];
        require(bal >= amount, "insufficient");
        balanceOf[msg.sender] = bal - amount;
        _alive(msg.sender);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send fail");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Send from your vault balance through a clearing window.
    /// @param to Recipient.
    /// @param amount Amount to send.
    /// @param requestedDelay Clearing window you ask for. If `to` is not yet a
    ///        cleared payee, the contract raises it to `minNewPayeeDelay`.
    /// @return id The new transfer id.
    function send(address to, uint256 amount, uint64 requestedDelay) external returns (uint256 id) {
        require(!accounts[msg.sender].frozen, "frozen");
        require(to != address(0), "zero to");
        require(to != msg.sender, "self");
        require(amount > 0, "zero");
        require(balanceOf[msg.sender] >= amount, "insufficient");
        require(_activePending[msg.sender].length < MAX_ACTIVE_PENDING, "too many pending");

        uint64 delay = requestedDelay;
        if (!cleared[msg.sender][to] && delay < minNewPayeeDelay) {
            delay = minNewPayeeDelay; // enforced floor for an untrusted payee
        }

        balanceOf[msg.sender] -= amount;
        id = nextTransferId++;
        uint64 unlockTime = uint64(block.timestamp) + delay;
        transfers[id] =
            Transfer({from: msg.sender, to: to, amount: amount, unlockTime: unlockTime, status: Status.Pending});
        _addPending(msg.sender, id);
        _alive(msg.sender);
        emit TransferCreated(id, msg.sender, to, amount, unlockTime);
    }

    /// @notice Recall a pending transfer before its window closes. Funds return
    ///         to your vault balance. Only the sender, only while still clearing.
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

    /// @notice Release a cleared transfer to its recipient. Permissionless once
    ///         the window has passed (recipient or a relayer can trigger it).
    ///         Blocked while the sender's account is frozen. Marks the payee
    ///         "cleared" so future sends to them can be instant.
    function claim(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        require(t.status == Status.Pending, "not pending");
        require(!accounts[t.from].frozen, "sender frozen");
        require(block.timestamp >= t.unlockTime, "still clearing");
        t.status = Status.Claimed;
        cleared[t.from][t.to] = true;
        _removePending(t.from, id);
        (bool ok,) = t.to.call{value: t.amount}("");
        require(ok, "send fail");
        emit TransferClaimed(id, t.to, t.amount);
    }

    // --------------------------------------------------------------------- //
    //                     Panic freeze  (protective, instant)               //
    // --------------------------------------------------------------------- //

    /// @notice Instantly freeze your own account: no withdraw, no send, no claim
    ///         of your pending transfers. Purely protective (never moves money),
    ///         so it is instant. Re-enabling egress (`unfreeze`) is delayed.
    function panic() external {
        _freeze(msg.sender, msg.sender);
    }

    /// @notice Your designated recovery contact can freeze your account
    ///         out-of-band (e.g. you tell them your phone was stolen). Still
    ///         purely protective: freezing can never move your money anywhere.
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

    /// @notice Sweep the entire account (balance + every pending send, which are
    ///         cancelled and reclaimed) to the pre-committed safe address, then
    ///         leave the account frozen. Callable by the owner OR the recovery
    ///         contact. It can ONLY ever pay the owner's own `safeAddress`
    ///         (set earlier, under timelock), so a malicious recovery contact
    ///         can move funds to the owner's cold wallet but can never steal.
    function killSwitch(address user) external nonReentrant {
        require(msg.sender == user || msg.sender == accounts[user].recoveryContact, "not authorized");
        address safe = accounts[user].safeAddress;
        require(safe != address(0), "no safe address");

        uint256 total = balanceOf[user];
        balanceOf[user] = 0;

        // Reclaim every still-pending outgoing send (bounded by MAX_ACTIVE_PENDING).
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
    /// @param kind  SetSafe | SetRecovery | SetHeir | SetInactivity | Unfreeze.
    /// @param addr  New address (for address kinds; must be non-zero).
    /// @param num   New value (for SetInactivity, in seconds).
    function requestChange(ChangeKind kind, address addr, uint64 num) external {
        require(kind != ChangeKind.None, "bad kind");
        require(pendingChange[msg.sender].kind == ChangeKind.None, "change pending");
        Account storage a = accounts[msg.sender];

        // Unfreeze is always timelocked (it re-enables egress) and needs no args.
        if (kind == ChangeKind.Unfreeze) {
            require(a.frozen, "not frozen");
        } else if (kind == ChangeKind.SetInactivity) {
            require(num > 0, "zero period");
            if (a.inactivityPeriod == 0) {
                _applyChange(msg.sender, kind, addr, num); // instant initial set
                return;
            }
        } else {
            // address kinds
            require(addr != address(0), "zero addr");
            require(addr != msg.sender, "self"); // don't name yourself as recovery/heir/safe helper role
            address current =
                kind == ChangeKind.SetSafe ? a.safeAddress : (kind == ChangeKind.SetRecovery ? a.recoveryContact : a.heir);
            if (current == address(0)) {
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

    function _applyChange(address user, ChangeKind kind, address addr, uint64 num) internal {
        Account storage a = accounts[user];
        if (kind == ChangeKind.SetSafe) {
            a.safeAddress = addr;
        } else if (kind == ChangeKind.SetRecovery) {
            a.recoveryContact = addr;
        } else if (kind == ChangeKind.SetHeir) {
            a.heir = addr;
        } else if (kind == ChangeKind.SetInactivity) {
            a.inactivityPeriod = num;
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

    /// @notice Number of active (still-pending) sends for a user.
    function activePendingCount(address user) external view returns (uint256) {
        return _activePending[user].length;
    }

    /// @notice The active (still-pending) transfer ids for a user.
    function activePendingIds(address user) external view returns (uint256[] memory) {
        return _activePending[user];
    }
}
