// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {LingerBond} from "../contracts/LingerBond.sol";

/**
 * @title Deterministic test vectors for the Decentraland meta-transaction audit
 *
 * @dev Emits every intermediate value of both EIP-712 paths so they can be reproduced by
 * an independent implementation. `script/crosscheck.js` recomputes the same digests with
 * ethers v5 — which is what a wallet's `eth_signTypedData_v4` uses — and compares.
 *
 * Two implementations agreeing on a digest is the only real evidence of compatibility.
 * Reasoning that the typestrings "look the same" is not.
 *
 * PRIVATE KEYS HERE ARE TEST-ONLY CONSTANTS. They control nothing.
 */
contract MetaTxVectorsTest is Test {
    LingerBond internal bond;

    // Test-only keys. Never used for anything but these vectors.
    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;

    // Polygon Amoy.
    uint256 internal constant CHAIN_ID = 80002;

    bytes32 internal constant BOND_REF =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant WORLD_HASH =
        0x2222222222222222222222222222222222222222222222222222222222222222;
    uint256 internal constant DEADLINE = 2000000000;

    address internal alice;
    address internal bobby;

    function setUp() public {
        vm.chainId(CHAIN_ID);
        // Fixed deployer + nonce so the address is reproducible across runs.
        vm.prank(address(0xF00D), address(0xF00D));
        bond = new LingerBond();

        alice = vm.addr(PK_A);
        bobby = vm.addr(PK_B);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Dumps the full BondConsent vector.
    function test_vector_bondConsent() public view {
        (address low, address high) = alice < bobby ? (alice, bobby) : (bobby, alice);

        bytes32 typeHash = keccak256(
            "BondConsent(bytes32 bondRef,address playerA,address playerB,bytes32 worldHash,uint256 deadline)"
        );
        bytes32 structHash =
            keccak256(abi.encode(typeHash, BOND_REF, low, high, WORLD_HASH, DEADLINE));
        bytes32 digest = bond.consentDigest(BOND_REF, alice, bobby, WORLD_HASH, DEADLINE);

        console2.log("VECTOR", "bondConsent");
        console2.log("chainId", vm.toString(block.chainid));
        console2.log("verifyingContract", vm.toString(address(bond)));
        console2.log("domainSeparator", vm.toString(bond.domainSeparator()));
        console2.log("consentTypeHash", vm.toString(typeHash));
        console2.log("playerA(low)", vm.toString(low));
        console2.log("playerB(high)", vm.toString(high));
        console2.log("bondRef", vm.toString(BOND_REF));
        console2.log("worldHash", vm.toString(WORLD_HASH));
        console2.log("deadline", vm.toString(DEADLINE));
        console2.log("structHash", vm.toString(structHash));
        console2.log("digest", vm.toString(digest));

        // The contract's own digest must equal the hand-built one.
        assertEq(
            digest,
            keccak256(abi.encodePacked("\x19\x01", bond.domainSeparator(), structHash)),
            "consent digest must equal manual EIP-712 construction"
        );

        bytes memory sigLow = _sign(alice < bobby ? PK_A : PK_B, digest);
        bytes memory sigHigh = _sign(alice < bobby ? PK_B : PK_A, digest);
        console2.log("signatureLow", vm.toString(sigLow));
        console2.log("signatureHigh", vm.toString(sigHigh));
    }

    /// @dev Dumps the full MetaTransaction vector wrapping a createBond call.
    function test_vector_metaTransaction() public view {
        bytes32 digest = bond.consentDigest(BOND_REF, alice, bobby, WORLD_HASH, DEADLINE);
        (address low, address high) = alice < bobby ? (alice, bobby) : (bobby, alice);

        bytes memory functionSignature = abi.encodeWithSelector(
            LingerBond.createBond.selector,
            BOND_REF,
            low,
            high,
            WORLD_HASH,
            DEADLINE,
            _sign(alice < bobby ? PK_A : PK_B, digest),
            _sign(alice < bobby ? PK_B : PK_A, digest)
        );

        bytes32 metaTypeHash =
            keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");
        bytes32 metaStructHash = keccak256(
            abi.encode(metaTypeHash, bond.getNonce(alice), alice, keccak256(functionSignature))
        );
        bytes32 metaDigest =
            keccak256(abi.encodePacked("\x19\x01", bond.domainSeparator(), metaStructHash));

        console2.log("VECTOR", "metaTransaction");
        console2.log("metaTypeHash", vm.toString(metaTypeHash));
        console2.log("nonce", vm.toString(bond.getNonce(alice)));
        console2.log("from", vm.toString(alice));
        console2.log("functionSignature", vm.toString(functionSignature));
        console2.log("functionSignatureHash", vm.toString(keccak256(functionSignature)));
        console2.log("metaStructHash", vm.toString(metaStructHash));
        console2.log("metaDigest", vm.toString(metaDigest));
        console2.log("metaSignature", vm.toString(_sign(PK_A, metaDigest)));
    }

    /// @dev The canonical domain separator, recomputed by hand.
    function test_vector_domainSeparator_matchesCanonicalConstruction() public view {
        bytes32 domainTypeHash = keccak256(
            "EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)"
        );
        bytes32 expected = keccak256(
            abi.encode(
                domainTypeHash,
                keccak256(bytes("LingerBond")),
                keccak256(bytes("1")),
                address(bond),
                // Canonical uses bytes32(getChainId()); block.chainid is the same opcode.
                bytes32(block.chainid)
            )
        );

        console2.log("domainTypeHash", vm.toString(domainTypeHash));
        console2.log("salt", vm.toString(bytes32(block.chainid)));
        console2.log("expectedDomainSeparator", vm.toString(expected));

        assertEq(bond.domainSeparator(), expected, "domain separator must match canonical form");
    }

}
