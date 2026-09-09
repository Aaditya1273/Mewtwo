// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title LingerBond
 * @notice Append-only registry of consented Bond provenance for LINGER.
 *
 * @dev WHAT THIS CONTRACT PROVES
 *
 * That two wallets each signed a statement agreeing to record a Bond with a given
 * reference, in a given World, before a given deadline.
 *
 * WHAT IT DOES NOT PROVE
 *
 * That the two people ever met inside LINGER. That fact is established by LINGER's
 * off-chain server, which observes live presence, and is not verifiable on-chain. This
 * contract is a provenance registry, not an oracle. See CONTRACT_SECURITY.md.
 *
 * @dev DESIGN
 *
 * - No owner, no admin, no pauser, no upgrade path. There are no privileged functions.
 * - Append-only. Nothing can modify or delete a recorded Bond; there is no code to do so.
 * - Not a token. No ERC-20/721/1155, no transfer, no approval, no URI, no metadata.
 * - Authorisation is purely signature-based and does NOT depend on `msg.sender` or on
 *   `_msgSender()`. Anyone may submit a Bond, but only with both participants' signatures.
 *   A malicious relayer therefore cannot forge, substitute or reorder participants.
 * - `executeMetaTransaction` is provided for compatibility with Decentraland's relayer
 *   (`decentraland-transactions`). Because authorisation ignores the caller entirely, a
 *   flaw in that path could not be used to record a Bond that both parties did not sign.
 *
 * @dev PRIVACY
 *
 * Chain data is permanently public. Only two addresses, two hashes, a timestamp and a
 * version are stored. No names, notes, Echo data, positions, session ids, realm ids or
 * free-form strings ever reach this contract.
 */
contract LingerBond {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice A recorded Bond. Written once, never mutated.
    struct Bond {
        /// @dev Lower of the two addresses. Ordering is canonical, not meaningful.
        address playerA;
        /// @dev Higher of the two addresses.
        address playerB;
        /// @dev keccak256 of the World identifier. Opaque on-chain.
        bytes32 worldHash;
        /// @dev Block timestamp at which the Bond was recorded.
        uint64 createdAt;
        /// @dev Record format version.
        uint16 version;
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Record format version written into every Bond.
    uint16 public constant PROTOCOL_VERSION = 1;

    string private constant EIP712_NAME = "LingerBond";
    string private constant EIP712_VERSION = "1";

    /// @dev Decentraland/Polygon put the chain id in `salt`, not in a `chainId` field.
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)"
    );

    /// @dev Both participants sign this identical struct. It binds every parameter.
    bytes32 private constant BOND_CONSENT_TYPEHASH = keccak256(
        "BondConsent(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline)"
    );

    /// @dev Matches Decentraland's NativeMetaTransaction exactly, for relayer compatibility.
    bytes32 private constant META_TRANSACTION_TYPEHASH =
        keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Domain separator. Immutable: bound to this contract and this chain.
    bytes32 public immutable domainSeparator;

    /// @dev bondRef => Bond. A non-zero playerA means the slot is taken, forever.
    mapping(bytes32 => Bond) private _bonds;

    /// @dev pairKey => bondRef. Stops one pair bonding twice in the same World.
    mapping(bytes32 => bytes32) private _pairBond;

    /// @dev Meta-transaction nonces. Only used by `executeMetaTransaction`.
    mapping(address => uint256) private _metaNonces;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event BondCreated(
        bytes32 indexed bondRef,
        address indexed playerA,
        address indexed playerB,
        bytes32 worldHash,
        uint64 createdAt,
        uint16 version
    );

    event MetaTransactionExecuted(address userAddress, address relayerAddress, bytes functionSignature);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroBondRef();
    error ZeroAddress();
    error IdenticalParticipants();
    error BondRefAlreadyUsed();
    error PairAlreadyBonded();
    error ConsentExpired();
    error InvalidConsent(address expected, address recovered);
    error MetaTransactionSignerMismatch();
    error MetaTransactionCallFailed();

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    constructor() {
        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                address(this),
                bytes32(block.chainid)
            )
        );
    }

    // -------------------------------------------------------------------------
    // Bond creation
    // -------------------------------------------------------------------------

    /**
     * @notice Record a Bond that both participants have signed for.
     *
     * @dev The caller is irrelevant to authorisation. Both `consentA` and `consentB` must
     * be valid EIP-712 signatures by `playerA` and `playerB` over the identical
     * `BondConsent` struct, which binds bondRef, both participants, the World and the
     * deadline. A relayer cannot substitute a participant, a bondRef or a World without
     * invalidating both signatures.
     *
     * Participants are stored in ascending address order so that (A,B) and (B,A) are the
     * same Bond. The order carries no meaning.
     *
     * @param playerA      One participant. Order as supplied does not matter.
     * @param playerB      The other participant.
     * @param bondRef      Opaque reference, keccak256(worldId, bondNumber) off-chain.
     * @param worldHash    keccak256 of the World identifier.
     * @param deadline     Unix time after which the consents are no longer valid.
     * @param consentA     `playerA`'s EIP-712 signature over the BondConsent struct.
     * @param consentB     `playerB`'s EIP-712 signature over the same struct.
     */
    function createBond(
        bytes32 bondRef,
        address playerA,
        address playerB,
        bytes32 worldHash,
        uint256 deadline,
        bytes calldata consentA,
        bytes calldata consentB
    ) external {
        // Split across helpers to keep the stack shallow: seven parameters plus the
        // intermediates do not fit in one frame without via-ir, and via-ir would be a
        // heavier answer than simply writing smaller functions.
        if (bondRef == bytes32(0)) revert ZeroBondRef();
        if (playerA == address(0) || playerB == address(0)) revert ZeroAddress();
        if (playerA == playerB) revert IdenticalParticipants();
        if (block.timestamp > deadline) revert ConsentExpired();

        // Canonical ordering. The signed struct, storage and the pair key all use it, so
        // (A,B) and (B,A) are indistinguishable everywhere.
        bool ordered = playerA < playerB;
        address low = ordered ? playerA : playerB;
        address high = ordered ? playerB : playerA;

        _requireAvailable(bondRef, worldHash, low, high);

        _verifyConsents(
            bondRef,
            low,
            high,
            worldHash,
            deadline,
            ordered ? consentA : consentB,
            ordered ? consentB : consentA
        );

        _record(bondRef, low, high, worldHash);
    }

    /// @dev Reverts unless both the bondRef slot and the pair slot are free.
    function _requireAvailable(bytes32 bondRef, bytes32 worldHash, address low, address high)
        private
        view
    {
        // A bondRef is a one-time slot. This is also what renders a captured consent
        // signature worthless once it has been used.
        if (_bonds[bondRef].playerA != address(0)) revert BondRefAlreadyUsed();
        if (_pairBond[_pairKey(worldHash, low, high)] != bytes32(0)) revert PairAlreadyBonded();
    }

    /// @dev Reverts unless both participants signed the identical consent struct.
    function _verifyConsents(
        bytes32 bondRef,
        address low,
        address high,
        bytes32 worldHash,
        uint256 deadline,
        bytes calldata lowSig,
        bytes calldata highSig
    ) private view {
        bytes32 digest = _consentDigest(bondRef, low, high, worldHash, deadline);

        address recoveredLow = ECDSA.recover(digest, lowSig);
        if (recoveredLow != low) revert InvalidConsent(low, recoveredLow);

        address recoveredHigh = ECDSA.recover(digest, highSig);
        if (recoveredHigh != high) revert InvalidConsent(high, recoveredHigh);
    }

    /// @dev The only function in this contract that writes a Bond. Write-once by construction.
    function _record(bytes32 bondRef, address low, address high, bytes32 worldHash) private {
        uint64 timestamp = uint64(block.timestamp);

        _bonds[bondRef] = Bond({
            playerA: low,
            playerB: high,
            worldHash: worldHash,
            createdAt: timestamp,
            version: PROTOCOL_VERSION
        });
        _pairBond[_pairKey(worldHash, low, high)] = bondRef;

        emit BondCreated(bondRef, low, high, worldHash, timestamp, PROTOCOL_VERSION);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice The Bond recorded under `bondRef`, or a zeroed struct if there is none.
    function bondOf(bytes32 bondRef) external view returns (Bond memory) {
        return _bonds[bondRef];
    }

    /// @notice Whether a Bond has been recorded under `bondRef`.
    function isRecorded(bytes32 bondRef) external view returns (bool) {
        return _bonds[bondRef].playerA != address(0);
    }

    /// @notice The bondRef binding two participants in a World, or zero if none.
    function bondRefForPair(bytes32 worldHash, address playerA, address playerB)
        external
        view
        returns (bytes32)
    {
        (address low, address high) = playerA < playerB ? (playerA, playerB) : (playerB, playerA);
        return _pairBond[_pairKey(worldHash, low, high)];
    }

    /// @notice The EIP-712 digest both participants must sign. Exposed for clients.
    function consentDigest(
        bytes32 bondRef,
        address playerA,
        address playerB,
        bytes32 worldHash,
        uint256 deadline
    ) external view returns (bytes32) {
        (address low, address high) = playerA < playerB ? (playerA, playerB) : (playerB, playerA);
        return _consentDigest(bondRef, low, high, worldHash, deadline);
    }

    /// @notice Meta-transaction nonce for a signer.
    function getNonce(address user) external view returns (uint256) {
        return _metaNonces[user];
    }

    // -------------------------------------------------------------------------
    // Meta-transaction (Decentraland relayer compatibility)
    // -------------------------------------------------------------------------

    /**
     * @notice Execute a call on behalf of `userAddress`, who signed it. The relayer pays gas.
     *
     * @dev Signature and semantics match Decentraland's `NativeMetaTransaction` so that
     * `decentraland-transactions` and the Decentraland transactions server can relay to
     * this contract unchanged.
     *
     * Two deliberate differences from the reference implementation:
     *  - OpenZeppelin `ECDSA.recover` is used instead of a bare `ecrecover`, which rejects
     *    malleable (high-s) signatures and the zero address rather than silently accepting.
     *  - Not `payable`. This contract has no use for value, and accepting it would only
     *    create a way to strand funds.
     *
     * SECURITY: nothing in this contract authorises anything based on `_msgSender()`.
     * This path is a convenience for relaying, not a source of authority.
     */
    function executeMetaTransaction(
        address userAddress,
        bytes calldata functionSignature,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) external returns (bytes memory) {
        bytes32 digest = _toTypedDataHash(
            keccak256(
                abi.encode(
                    META_TRANSACTION_TYPEHASH,
                    _metaNonces[userAddress],
                    userAddress,
                    keccak256(functionSignature)
                )
            )
        );

        if (ECDSA.recover(digest, sigV, sigR, sigS) != userAddress) {
            revert MetaTransactionSignerMismatch();
        }

        unchecked {
            _metaNonces[userAddress] += 1;
        }

        emit MetaTransactionExecuted(userAddress, msg.sender, functionSignature);

        (bool success, bytes memory returnData) =
            address(this).call(abi.encodePacked(functionSignature, userAddress));
        if (!success) revert MetaTransactionCallFailed();

        return returnData;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /// @dev Ordered inputs only. Callers normalise before calling.
    function _pairKey(bytes32 worldHash, address low, address high) private pure returns (bytes32) {
        return keccak256(abi.encode(worldHash, low, high));
    }

    function _consentDigest(
        bytes32 bondRef,
        address low,
        address high,
        bytes32 worldHash,
        uint256 deadline
    ) private view returns (bytes32) {
        return _toTypedDataHash(
            keccak256(abi.encode(BOND_CONSENT_TYPEHASH, bondRef, low, high, worldHash, deadline))
        );
    }

    function _toTypedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
