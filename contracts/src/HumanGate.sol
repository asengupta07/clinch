// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

/// @notice World ID v3 router interface (WorldIDRouter.verifyProof). Reverts on an invalid proof.
interface IWorldID {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}

/// @notice The comparison arm: a per-human cap on top of Clinch, using World ID.
///
/// ClinchLaunch itself needs no identity. To run the same launch with a per-human cap, the launch
/// is created with this contract as its quote token. HumanGate is a 1:1 voucher for a real quote
/// token (e.g. USDC) that only a verified human can mint, and only up to `cap` in total:
///
///   1. verify(): one World ID proof per human for `action`, bound to the caller's wallet
///      (signal = wallet). A reused nullifier is rejected, so each human has exactly one wallet here.
///   2. deposit(): lock USDC, mint hUSD, while the human's lifetime deposits stay <= cap.
///   3. Bid on the launch with hUSD as usual. Refunds and pool proceeds come back as hUSD.
///   4. redeem(): burn hUSD for USDC at any time, by anyone holding it.
///
/// hUSD moves only to or from a registered venue (the launch, the v4 PoolManager, the hook), so
/// one human cannot pass allowance to sybil wallets. Core contracts are unchanged.
contract HumanGate is ERC20 {
    using SafeTransferLib for ERC20;

    uint256 internal constant GROUP_ID = 1; // Orb

    IWorldID public immutable worldId;
    ERC20 public immutable underlying;
    uint256 public immutable externalNullifierHash;
    uint256 public immutable cap;
    address public owner;

    mapping(uint256 => address) public walletOf; // nullifier hash -> wallet
    mapping(address => uint256) public humanOf; // wallet -> nullifier hash (0 = not verified)
    mapping(uint256 => uint256) public deposited; // nullifier hash -> lifetime deposits
    mapping(address => bool) public isVenue;

    event Verified(address indexed wallet, uint256 nullifierHash);
    event Deposited(address indexed wallet, uint256 indexed nullifierHash, uint256 amount);
    event Redeemed(address indexed wallet, uint256 amount);
    event VenueSet(address venue, bool allowed);

    error NotOwner();
    error AlreadyVerified();
    error NullifierUsed();
    error NotVerified();
    error OverCap();
    error NotTransferable();

    constructor(IWorldID _worldId, ERC20 _underlying, string memory appId, string memory action, uint256 _cap)
        ERC20(
            string.concat("Human-capped ", _underlying.name()),
            string.concat("h", _underlying.symbol()),
            _underlying.decimals()
        )
    {
        worldId = _worldId;
        underlying = _underlying;
        cap = _cap;
        owner = msg.sender;
        externalNullifierHash = hashToField(abi.encodePacked(hashToField(abi.encodePacked(appId)), action));
    }

    /// @dev World ID's field hash: keccak256 shifted right by 8 bits to fit the BN254 scalar field.
    function hashToField(bytes memory value) public pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function signalHashOf(address wallet) public pure returns (uint256) {
        return hashToField(abi.encodePacked(wallet));
    }

    /// @notice Prove you are a unique human and bind this wallet to you.
    function verify(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (humanOf[msg.sender] != 0) revert AlreadyVerified();
        if (walletOf[nullifierHash] != address(0)) revert NullifierUsed();
        worldId.verifyProof(root, GROUP_ID, signalHashOf(msg.sender), nullifierHash, externalNullifierHash, proof);
        walletOf[nullifierHash] = msg.sender;
        humanOf[msg.sender] = nullifierHash;
        emit Verified(msg.sender, nullifierHash);
    }

    function remaining(address wallet) external view returns (uint256) {
        uint256 h = humanOf[wallet];
        return h == 0 ? 0 : cap - deposited[h];
    }

    function deposit(uint256 amount) external {
        uint256 h = humanOf[msg.sender];
        if (h == 0) revert NotVerified();
        if (deposited[h] + amount > cap) revert OverCap();
        deposited[h] += amount;
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
        emit Deposited(msg.sender, h, amount);
    }

    function redeem(uint256 amount) external {
        _burn(msg.sender, amount);
        underlying.safeTransfer(msg.sender, amount);
        emit Redeemed(msg.sender, amount);
    }

    function setVenue(address venue, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        isVenue[venue] = allowed;
        emit VenueSet(venue, allowed);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        owner = to;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!isVenue[msg.sender] && !isVenue[to]) revert NotTransferable();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!isVenue[from] && !isVenue[to]) revert NotTransferable();
        return super.transferFrom(from, to, amount);
    }
}

/// @notice Stand-in for the World ID router on chains or demos without real proofs. A proof is valid
///         iff proof[0] commits to the public inputs, so the app can simulate World App, while bad,
///         mismatched-signal and reused proofs are still rejected exactly as with the real router.
///         Never use where real sybil resistance matters: anyone can compute a valid mock proof.
contract MockWorldID is IWorldID {
    error InvalidProof();

    function commitment(uint256 root, uint256 groupId, uint256 signalHash, uint256 nullifierHash, uint256 extNullifier)
        public
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(root, groupId, signalHash, nullifierHash, extNullifier))) >> 8;
    }

    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external pure {
        if (proof[0] != commitment(root, groupId, signalHash, nullifierHash, externalNullifierHash)) revert InvalidProof();
    }
}

/// @notice World ID verified off chain, enforced on chain. World ID 4.0 proofs are checked by the
///         World Developer Portal (POST /api/v4/verify/{rp_id}); there is no 4.0 verifier on Ethereum
///         Sepolia. Our server forwards the IDKit result to the portal, checks that its signal is the
///         caller's wallet, and signs (chain, this, signalHash, nullifierHash, externalNullifierHash).
///         proof[0..2] carry that signature as (r, s, v). The gate still enforces one wallet per
///         nullifier, so the server can't double-issue for a human; it can only vouch for proofs.
contract AttestedWorldID is IWorldID {
    address public immutable attester;

    error InvalidProof();

    constructor(address _attester) {
        attester = _attester;
    }

    function digest(uint256 signalHash, uint256 nullifierHash, uint256 externalNullifierHash) public view returns (bytes32) {
        bytes32 h = keccak256(abi.encode(block.chainid, address(this), signalHash, nullifierHash, externalNullifierHash));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function verifyProof(
        uint256,
        uint256,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view {
        if (proof[2] > type(uint8).max || proof[1] > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidProof();
        address signer =
            ecrecover(digest(signalHash, nullifierHash, externalNullifierHash), uint8(proof[2]), bytes32(proof[0]), bytes32(proof[1]));
        if (signer == address(0) || signer != attester) revert InvalidProof();
    }
}
