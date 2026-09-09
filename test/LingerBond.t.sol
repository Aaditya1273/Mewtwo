// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LingerBond} from "../contracts/LingerBond.sol";

/**
 * @title LingerBond test suite
 *
 * @dev The governing property throughout: a Bond can only be recorded when BOTH
 * participants have signed the identical consent. Nothing about who submits the
 * transaction — relayer, stranger, or a participant — can change that.
 */
contract LingerBondTest is Test {
    LingerBond internal bond;

    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;
    uint256 internal constant PK_C = 0xCA401;
    uint256 internal constant PK_RELAYER = 0xBEEF;

    address internal alice;
    address internal bobby;
    address internal carol;
    address internal relayer;

    bytes32 internal constant BOND_REF = keccak256("linger:v1:15:linger.dcl.eth:1");
    bytes32 internal constant WORLD = keccak256("linger.dcl.eth");

    uint256 internal deadline;

    event BondCreated(
        bytes32 indexed bondRef,
        address indexed playerA,
        address indexed playerB,
        bytes32 worldHash,
        uint64 createdAt,
        uint16 version
    );

    function setUp() public {
        bond = new LingerBond();

        alice = vm.addr(PK_A);
        bobby = vm.addr(PK_B);
        carol = vm.addr(PK_C);
        relayer = vm.addr(PK_RELAYER);

        // A timestamp that is not 1, so expiry tests are meaningful.
        vm.warp(1_800_000_000);
        deadline = block.timestamp + 1 hours;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _consent(uint256 pk, bytes32 bondRef, address a, address b, bytes32 world, uint256 dl)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, bond.consentDigest(bondRef, a, b, world, dl));
    }

    /// @dev Records the canonical Bond, submitted by an uninvolved relayer.
    function _createDefault() internal {
        vm.prank(relayer);
        bond.createBond(
            BOND_REF,
            alice,
            bobby,
            WORLD,
            deadline,
            _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline),
            _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline)
        );
    }

    /**
     * @dev Consents for the canonical Bond, computed up front.
     *
     * `vm.expectRevert` arms the NEXT call, so any argument expression that itself makes
     * a call — `consentDigest`, or a `vm.prank` inside a helper — would consume the
     * expectation instead of the call under test. Signatures are therefore always hoisted
     * into locals before an `expectRevert`.
     */
    function _defaultConsents() internal view returns (bytes memory ca, bytes memory cb) {
        ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);
    }

    function _lower(address a, address b) internal pure returns (address) {
        return a < b ? a : b;
    }

    function _higher(address a, address b) internal pure returns (address) {
        return a < b ? b : a;
    }

    // =========================================================================
    // BASIC
    // =========================================================================

    function test_createBond_records() public {
        _createDefault();

        LingerBond.Bond memory recorded = bond.bondOf(BOND_REF);
        assertEq(recorded.playerA, _lower(alice, bobby), "playerA is the lower address");
        assertEq(recorded.playerB, _higher(alice, bobby), "playerB is the higher address");
        assertEq(recorded.worldHash, WORLD);
        assertEq(recorded.createdAt, uint64(block.timestamp));
        assertEq(recorded.version, bond.PROTOCOL_VERSION());
    }

    function test_isRecorded() public {
        assertFalse(bond.isRecorded(BOND_REF));
        _createDefault();
        assertTrue(bond.isRecorded(BOND_REF));
    }

    function test_unrecordedBond_isZeroed() public view {
        LingerBond.Bond memory empty = bond.bondOf(keccak256("never"));
        assertEq(empty.playerA, address(0));
        assertEq(empty.playerB, address(0));
        assertEq(empty.worldHash, bytes32(0));
        assertEq(empty.createdAt, 0);
        assertEq(empty.version, 0);
    }

    function test_bondRefForPair_isOrderIndependent() public {
        _createDefault();
        assertEq(bond.bondRefForPair(WORLD, alice, bobby), BOND_REF);
        assertEq(bond.bondRefForPair(WORLD, bobby, alice), BOND_REF, "reversed lookup matches");
    }

    function test_bondRefForPair_zeroWhenAbsent() public view {
        assertEq(bond.bondRefForPair(WORLD, alice, carol), bytes32(0));
    }

    function test_emitsBondCreated() public {
        vm.expectEmit(true, true, true, true, address(bond));
        emit BondCreated(
            BOND_REF,
            _lower(alice, bobby),
            _higher(alice, bobby),
            WORLD,
            uint64(block.timestamp),
            1
        );
        _createDefault();
    }

    function test_protocolVersionIsOne() public view {
        assertEq(bond.PROTOCOL_VERSION(), 1);
    }

    // =========================================================================
    // INVALID INPUT
    // =========================================================================

    function test_revert_zeroBondRef() public {
        bytes memory ca = _consent(PK_A, bytes32(0), alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, bytes32(0), alice, bobby, WORLD, deadline);

        vm.expectRevert(LingerBond.ZeroBondRef.selector);
        bond.createBond(bytes32(0), alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_revert_zeroPlayerA() public {
        bytes memory sig = _consent(PK_B, BOND_REF, address(0), bobby, WORLD, deadline);

        vm.expectRevert(LingerBond.ZeroAddress.selector);
        bond.createBond(BOND_REF, address(0), bobby, WORLD, deadline, sig, sig);
    }

    function test_revert_zeroPlayerB() public {
        bytes memory sig = _consent(PK_A, BOND_REF, alice, address(0), WORLD, deadline);

        vm.expectRevert(LingerBond.ZeroAddress.selector);
        bond.createBond(BOND_REF, alice, address(0), WORLD, deadline, sig, sig);
    }

    function test_revert_identicalParticipants() public {
        bytes memory sig = _consent(PK_A, BOND_REF, alice, alice, WORLD, deadline);

        vm.expectRevert(LingerBond.IdenticalParticipants.selector);
        bond.createBond(BOND_REF, alice, alice, WORLD, deadline, sig, sig);
    }

    // =========================================================================
    // DUPLICATES
    // =========================================================================

    function test_revert_sameBondRefTwice() public {
        (bytes memory ca, bytes memory cb) = _defaultConsents();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);

        vm.expectRevert(LingerBond.BondRefAlreadyUsed.selector);
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_revert_reversedPairIsTheSameBond() public {
        _createDefault();

        // Same two people, opposite argument order, a fresh bondRef.
        bytes32 otherRef = keccak256("linger:v1:15:linger.dcl.eth:2");
        bytes memory cb = _consent(PK_B, otherRef, bobby, alice, WORLD, deadline);
        bytes memory ca = _consent(PK_A, otherRef, bobby, alice, WORLD, deadline);

        vm.expectRevert(LingerBond.PairAlreadyBonded.selector);
        bond.createBond(otherRef, bobby, alice, WORLD, deadline, cb, ca);
    }

    function test_revert_samePairDifferentBondRef() public {
        _createDefault();

        bytes32 otherRef = keccak256("a-different-reference");
        bytes memory ca = _consent(PK_A, otherRef, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, otherRef, alice, bobby, WORLD, deadline);

        vm.expectRevert(LingerBond.PairAlreadyBonded.selector);
        bond.createBond(otherRef, alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_revert_sameBondRefDifferentParticipants() public {
        _createDefault();

        // The bondRef slot is taken, so even a different, fully-consented pair is refused.
        bytes memory ca = _consent(PK_A, BOND_REF, alice, carol, WORLD, deadline);
        bytes memory cc = _consent(PK_C, BOND_REF, alice, carol, WORLD, deadline);

        vm.expectRevert(LingerBond.BondRefAlreadyUsed.selector);
        bond.createBond(BOND_REF, alice, carol, WORLD, deadline, ca, cc);
    }

    function test_samePairInAnotherWorldIsAllowed() public {
        _createDefault();

        // Pair uniqueness is scoped per World, matching the off-chain server, where a
        // Bond belongs to the World it was formed in.
        bytes32 otherWorld = keccak256("another.dcl.eth");
        bytes32 otherRef = keccak256("linger:v1:16:another.dcl.eth:1");

        bond.createBond(
            otherRef,
            alice,
            bobby,
            otherWorld,
            deadline,
            _consent(PK_A, otherRef, alice, bobby, otherWorld, deadline),
            _consent(PK_B, otherRef, alice, bobby, otherWorld, deadline)
        );

        assertEq(bond.bondRefForPair(otherWorld, alice, bobby), otherRef);
        assertEq(bond.bondRefForPair(WORLD, alice, bobby), BOND_REF, "the first is untouched");
    }

    function test_differentPairsCoexist() public {
        _createDefault();

        bytes32 ref2 = keccak256("bond-2");
        bond.createBond(
            ref2,
            alice,
            carol,
            WORLD,
            deadline,
            _consent(PK_A, ref2, alice, carol, WORLD, deadline),
            _consent(PK_C, ref2, alice, carol, WORLD, deadline)
        );

        assertTrue(bond.isRecorded(BOND_REF));
        assertTrue(bond.isRecorded(ref2));
    }

    // =========================================================================
    // IMMUTABILITY
    // =========================================================================

    function test_immutable_noMutatingFunctionsExist() public {
        _createDefault();
        LingerBond.Bond memory before = bond.bondOf(BOND_REF);

        // There is no setter, updater or deleter to call — the ABI contains none. The
        // only way to touch a recorded Bond would be createBond, which refuses.
        (bytes memory ca, bytes memory cb) = _defaultConsents();
        vm.expectRevert(LingerBond.BondRefAlreadyUsed.selector);
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);

        LingerBond.Bond memory sameAfter = bond.bondOf(BOND_REF);
        assertEq(sameAfter.playerA, before.playerA);
        assertEq(sameAfter.playerB, before.playerB);
        assertEq(sameAfter.worldHash, before.worldHash);
        assertEq(sameAfter.createdAt, before.createdAt);
        assertEq(sameAfter.version, before.version);
    }

    function test_immutable_survivesTimeAndOtherBonds() public {
        _createDefault();
        LingerBond.Bond memory before = bond.bondOf(BOND_REF);

        vm.warp(block.timestamp + 365 days);
        bytes32 ref2 = keccak256("later-bond");
        uint256 laterDeadline = block.timestamp + 1 hours;
        bond.createBond(
            ref2,
            alice,
            carol,
            WORLD,
            laterDeadline,
            _consent(PK_A, ref2, alice, carol, WORLD, laterDeadline),
            _consent(PK_C, ref2, alice, carol, WORLD, laterDeadline)
        );

        LingerBond.Bond memory unchangedBond = bond.bondOf(BOND_REF);
        assertEq(unchangedBond.createdAt, before.createdAt, "createdAt never moves");
        assertEq(unchangedBond.playerA, before.playerA);
        assertEq(unchangedBond.playerB, before.playerB);
    }

    // =========================================================================
    // AUTHORISATION
    // =========================================================================

    function test_revert_missingConsentFromB() public {
        // A signs twice. B never agreed.
        bytes memory onlyA = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);

        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, onlyA, onlyA);
    }

    function test_revert_thirdPartySignsForB() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory forged = _consent(PK_C, BOND_REF, alice, bobby, WORLD, deadline);

        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, forged);
    }

    function test_revert_garbageSignature() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory garbage = new bytes(65);

        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, garbage);
    }

    function test_revert_wrongLengthSignature() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);

        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, hex"1234");
    }

    function test_revert_expiredConsent() public {
        uint256 past = block.timestamp - 1;
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, past);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, past);

        vm.expectRevert(LingerBond.ConsentExpired.selector);
        bond.createBond(BOND_REF, alice, bobby, WORLD, past, ca, cb);
    }

    function test_consentValidExactlyOnDeadline() public {
        uint256 exact = block.timestamp;
        bond.createBond(
            BOND_REF,
            alice,
            bobby,
            WORLD,
            exact,
            _consent(PK_A, BOND_REF, alice, bobby, WORLD, exact),
            _consent(PK_B, BOND_REF, alice, bobby, WORLD, exact)
        );
        assertTrue(bond.isRecorded(BOND_REF));
    }

    function test_revert_consentGoesStale() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        // A captured pair of consents cannot be banked and used later.
        vm.warp(deadline + 1);
        vm.expectRevert(LingerBond.ConsentExpired.selector);
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
    }

    // =========================================================================
    // DOMAIN BINDING
    // =========================================================================

    function test_revert_signatureFromAnotherContract() public {
        LingerBond other = new LingerBond();

        // Consents signed for `other`'s domain must not work here.
        bytes memory ca = _sign(PK_A, other.consentDigest(BOND_REF, alice, bobby, WORLD, deadline));
        bytes memory cb = _sign(PK_B, other.consentDigest(BOND_REF, alice, bobby, WORLD, deadline));

        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_revert_signatureFromAnotherChain() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        // Redeploy under a different chain id: the domain separator changes, so consents
        // signed for the original chain are worthless.
        vm.chainId(999);
        LingerBond elsewhere = new LingerBond();

        vm.expectRevert();
        elsewhere.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_domainSeparatorIsBoundToContractAndChain() public {
        LingerBond other = new LingerBond();
        assertTrue(
            bond.domainSeparator() != other.domainSeparator(),
            "two deployments must not share a domain"
        );
    }

    // =========================================================================
    // PARAMETER SUBSTITUTION
    // =========================================================================

    function test_revert_relayerSwapsWorldHash() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        vm.prank(relayer);
        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, keccak256("evil.dcl.eth"), deadline, ca, cb);
    }

    function test_revert_relayerSwapsBondRef() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        vm.prank(relayer);
        vm.expectRevert();
        bond.createBond(keccak256("substituted"), alice, bobby, WORLD, deadline, ca, cb);
    }

    function test_revert_relayerSwapsParticipant() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        // Carol never signed anything for this Bond.
        vm.prank(relayer);
        vm.expectRevert();
        bond.createBond(BOND_REF, alice, carol, WORLD, deadline, ca, cb);
    }

    function test_revert_relayerInsertsItselfAsParticipant() public {
        // The classic relayer attack: take B's genuine consent and become the counterparty.
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory selfSigned = _consent(PK_RELAYER, BOND_REF, relayer, bobby, WORLD, deadline);

        vm.prank(relayer);
        vm.expectRevert();
        bond.createBond(BOND_REF, relayer, bobby, WORLD, deadline, selfSigned, cb);
    }

    function test_revert_relayerExtendsDeadline() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        vm.prank(relayer);
        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline + 10 days, ca, cb);
    }

    function test_revert_consentsSwapped() public {
        // A's signature offered as B's and vice versa.
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        // Argument order is (playerA, playerB, consentA, consentB). Passing them crossed
        // must fail, because each signature is checked against its own participant.
        vm.expectRevert();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, cb, ca);
    }

    // =========================================================================
    // ANYONE MAY SUBMIT
    // =========================================================================

    function test_strangerMaySubmitFullyConsentedBond() public {
        // Authorisation is the two signatures, not the caller. This is deliberate: it is
        // what lets a relayer pay the gas.
        address stranger = address(0xDEAD);
        vm.prank(stranger);
        bond.createBond(
            BOND_REF,
            alice,
            bobby,
            WORLD,
            deadline,
            _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline),
            _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline)
        );
        assertTrue(bond.isRecorded(BOND_REF));
    }

    function test_participantMaySubmitDirectly() public {
        vm.prank(alice);
        bond.createBond(
            BOND_REF,
            alice,
            bobby,
            WORLD,
            deadline,
            _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline),
            _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline)
        );
        assertTrue(bond.isRecorded(BOND_REF));
    }

    // =========================================================================
    // META-TRANSACTION
    // =========================================================================

    function _metaDigest(address user, bytes memory functionSignature)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)"),
                bond.getNonce(user),
                user,
                keccak256(functionSignature)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", bond.domainSeparator(), structHash));
    }

    function _createCalldata() internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            LingerBond.createBond.selector,
            BOND_REF,
            alice,
            bobby,
            WORLD,
            deadline,
            _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline),
            _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline)
        );
    }

    function test_metaTransaction_relayedByThirdParty() public {
        bytes memory fnSig = _createCalldata();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(alice, fnSig));

        vm.prank(relayer);
        bond.executeMetaTransaction(alice, fnSig, r, s, v);

        assertTrue(bond.isRecorded(BOND_REF));
        assertEq(bond.getNonce(alice), 1, "nonce advances");
    }

    function test_metaTransaction_userNeedsNoFunds() public {
        // The whole point of the gasless design: the signer holds nothing and still acts.
        assertEq(alice.balance, 0, "signer is unfunded");

        bytes memory fnSig = _createCalldata();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(alice, fnSig));

        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        bond.executeMetaTransaction(alice, fnSig, r, s, v);

        assertTrue(bond.isRecorded(BOND_REF));
        assertEq(alice.balance, 0, "signer still holds nothing");
    }

    function test_revert_metaTransaction_replay() public {
        bytes memory fnSig = _createCalldata();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(alice, fnSig));

        vm.prank(relayer);
        bond.executeMetaTransaction(alice, fnSig, r, s, v);

        // The nonce has moved, so the same signed meta-transaction no longer verifies.
        vm.prank(relayer);
        vm.expectRevert(LingerBond.MetaTransactionSignerMismatch.selector);
        bond.executeMetaTransaction(alice, fnSig, r, s, v);
    }

    function test_revert_metaTransaction_wrongSignerClaimed() public {
        bytes memory fnSig = _createCalldata();
        // Alice signs; the relayer claims it was Bobby.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(bobby, fnSig));

        vm.prank(relayer);
        vm.expectRevert(LingerBond.MetaTransactionSignerMismatch.selector);
        bond.executeMetaTransaction(bobby, fnSig, r, s, v);
    }

    function test_revert_metaTransaction_tamperedPayload() public {
        bytes memory fnSig = _createCalldata();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(alice, fnSig));

        // Swap the payload after signing.
        bytes memory tampered = abi.encodeWithSelector(
            LingerBond.createBond.selector,
            keccak256("other"),
            alice,
            carol,
            WORLD,
            deadline,
            _consent(PK_A, keccak256("other"), alice, carol, WORLD, deadline),
            _consent(PK_C, keccak256("other"), alice, carol, WORLD, deadline)
        );

        vm.prank(relayer);
        vm.expectRevert(LingerBond.MetaTransactionSignerMismatch.selector);
        bond.executeMetaTransaction(alice, tampered, r, s, v);
    }

    function test_metaTransaction_cannotBypassConsent() public {
        // The critical property: the meta-transaction path confers NO authority. Alice
        // signing a meta-transaction does not substitute for Bobby's consent.
        bytes memory onlyA = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory fnSig = abi.encodeWithSelector(
            LingerBond.createBond.selector, BOND_REF, alice, bobby, WORLD, deadline, onlyA, onlyA
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_A, _metaDigest(alice, fnSig));

        vm.prank(relayer);
        vm.expectRevert(LingerBond.MetaTransactionCallFailed.selector);
        bond.executeMetaTransaction(alice, fnSig, r, s, v);

        assertFalse(bond.isRecorded(BOND_REF));
    }

    function test_metaTransaction_noncesArePerAccount() public view {
        assertEq(bond.getNonce(alice), 0);
        assertEq(bond.getNonce(bobby), 0);
        assertEq(bond.getNonce(relayer), 0);
    }

    // =========================================================================
    // FUZZ
    // =========================================================================

    /// @dev secp256k1 group order. Fuzzed private keys are bounded into [1, n-1].
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140;

    /// @dev Extracted to keep the fuzz frames shallow enough to compile without via-ir.
    function _createSigned(bytes32 bondRef, uint256 pkA, uint256 pkB, bytes32 worldHash) internal {
        address a = vm.addr(pkA);
        address b = vm.addr(pkB);
        bytes32 digest = bond.consentDigest(bondRef, a, b, worldHash, deadline);
        bond.createBond(bondRef, a, b, worldHash, deadline, _sign(pkA, digest), _sign(pkB, digest));
    }

    function testFuzz_anyValidPairAndRefRecords(
        bytes32 bondRef,
        bytes32 worldHash,
        uint256 pkA,
        uint256 pkB
    ) public {
        pkA = bound(pkA, 1, SECP256K1_N - 1);
        pkB = bound(pkB, 1, SECP256K1_N - 1);

        vm.assume(bondRef != bytes32(0));
        vm.assume(vm.addr(pkA) != vm.addr(pkB));

        _createSigned(bondRef, pkA, pkB, worldHash);

        LingerBond.Bond memory recorded = bond.bondOf(bondRef);
        assertEq(recorded.playerA, _lower(vm.addr(pkA), vm.addr(pkB)));
        assertEq(recorded.playerB, _higher(vm.addr(pkA), vm.addr(pkB)));
        assertEq(recorded.worldHash, worldHash);
    }

    function testFuzz_duplicateBondRefAlwaysRejected(bytes32 bondRef) public {
        vm.assume(bondRef != bytes32(0));

        bytes memory ca = _consent(PK_A, bondRef, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, bondRef, alice, bobby, WORLD, deadline);

        bond.createBond(bondRef, alice, bobby, WORLD, deadline, ca, cb);

        vm.expectRevert(LingerBond.BondRefAlreadyUsed.selector);
        bond.createBond(bondRef, alice, bobby, WORLD, deadline, ca, cb);
    }

    function testFuzz_orderDoesNotMatter(bytes32 worldHash) public {
        bond.createBond(
            BOND_REF,
            alice,
            bobby,
            worldHash,
            deadline,
            _consent(PK_A, BOND_REF, alice, bobby, worldHash, deadline),
            _consent(PK_B, BOND_REF, alice, bobby, worldHash, deadline)
        );

        // Whichever way round it is looked up, it is the same Bond.
        assertEq(bond.bondRefForPair(worldHash, alice, bobby), BOND_REF);
        assertEq(bond.bondRefForPair(worldHash, bobby, alice), BOND_REF);
    }

    function testFuzz_forgedConsentNeverRecords(uint256 forgerPk, bytes32 bondRef) public {
        forgerPk = bound(forgerPk, 1, SECP256K1_N - 1);
        vm.assume(bondRef != bytes32(0));
        vm.assume(vm.addr(forgerPk) != bobby);

        bytes memory ca = _consent(PK_A, bondRef, alice, bobby, WORLD, deadline);
        bytes memory forged = _sign(forgerPk, bond.consentDigest(bondRef, alice, bobby, WORLD, deadline));

        vm.expectRevert();
        bond.createBond(bondRef, alice, bobby, WORLD, deadline, ca, forged);
        assertFalse(bond.isRecorded(bondRef));
    }

    function testFuzz_expiredConsentNeverRecords(uint256 elapsed) public {
        elapsed = bound(elapsed, 1, 3650 days);

        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        vm.warp(deadline + elapsed);
        vm.expectRevert(LingerBond.ConsentExpired.selector);
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
    }

    // =========================================================================
    // GAS
    // =========================================================================

    function test_gas_createBond() public {
        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        uint256 before = gasleft();
        bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb);
        uint256 used = before - gasleft();

        emit log_named_uint("gas: createBond (first)", used);
        assertLt(used, 250_000, "creation must stay well under a Polygon block budget");
    }

    function test_gas_lookup() public {
        _createDefault();

        uint256 before = gasleft();
        bond.bondOf(BOND_REF);
        uint256 used = before - gasleft();

        emit log_named_uint("gas: bondOf lookup", used);
    }

    function test_gas_duplicateRejection() public {
        _createDefault();

        bytes memory ca = _consent(PK_A, BOND_REF, alice, bobby, WORLD, deadline);
        bytes memory cb = _consent(PK_B, BOND_REF, alice, bobby, WORLD, deadline);

        uint256 before = gasleft();
        try bond.createBond(BOND_REF, alice, bobby, WORLD, deadline, ca, cb) {
            revert("should have reverted");
        } catch {
            emit log_named_uint("gas: duplicate rejection", before - gasleft());
        }
    }
}
