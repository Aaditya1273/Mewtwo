// Runs inside scripts/e2e_localnet.sh against the attestation the Python settlement test just wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { verifyPresence } from "../src/index.ts";

const file = process.env.ATTESTED_OUT;

test("verifyPresence reads a real attestation from chain", { skip: !file }, async () => {
  const w = JSON.parse(readFileSync(file!, "utf8"));
  const connection = new Connection(w.rpc, "confirmed");
  const opts = { mission: w.mission, day: w.day, programId: new PublicKey(w.program_id) };
  const wallet = new PublicKey(w.wallet);

  const r = await verifyPresence(connection, wallet, opts);
  assert.equal(r.verified, true, r.reason);
  assert.equal(r.assuranceLevel, 2);
  assert.equal(r.evidenceRoot, w.evidence_root);
  assert.equal(r.attestor, w.attestor);
  assert.equal(r.profile.attestations, 1);

  assert.equal((await verifyPresence(connection, wallet, { ...opts, mission: "cold-chain-cargo" })).verified, false);
  assert.equal((await verifyPresence(connection, wallet, { ...opts, day: w.day - 1 })).verified, false);
  const stranger = Keypair.generate().publicKey;
  assert.equal((await verifyPresence(connection, wallet, { ...opts, trustedAttestors: [stranger] })).verified, false);
});
