/**
 * verifyPresence(): ask Solana, not the PRESENCE server, whether a wallet holds an attested action.
 *
 *   const r = await verifyPresence(connection, wallet, { mission: "asha-village-visit" })
 *   if (r.verified && r.assuranceLevel >= 2) payWorker()
 *
 * Trust comes from the program: an attestation account can only be created by the program, and only
 * with a signature from Config.attestor. We check account ownership and that the recorded attestor is
 * the configured one (or one you explicitly trust).
 */
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("CFZsFPtvwo5KDenV3qgorroaRmT7NuYsfPnd4avFS2cT");
const SECONDS_PER_DAY = 86_400;

export interface PresenceResult {
  verified: boolean;
  reason?: string;
  assuranceLevel: number; // 2 = P2 PROCESS
  evidenceRoot?: string; // hex commitment to the session's evidence chain
  attestation?: string; // account address
  attestor?: string;
  recordedAt?: number;
  profile: { exists: boolean; streak: number; reputation: number; attestations: number; level: number };
}

export interface VerifyOptions {
  mission: string; // mission id, e.g. "asha-village-visit"
  day?: number; // UTC day number (unix_ts / 86400); default today
  seq?: number; // claim index for multi-claim missions; default 0 (first claim of the day)
  programId?: PublicKey;
  trustedAttestors?: PublicKey[]; // default: whatever Config.attestor says
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();
const i64le = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (seeds: Buffer[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const discriminator = (name: string) => sha256(`account:${name}`).subarray(0, 8);

export function addresses(wallet: PublicKey, mission: string, day: number, seq = 0, programId = PROGRAM_ID) {
  const config = pda([Buffer.from("config")], programId);
  const profile = pda([Buffer.from("profile"), wallet.toBuffer()], programId);
  const attestation = pda(
    [Buffer.from("attestation"), profile.toBuffer(), sha256(mission), i64le(day), Buffer.from([seq])], programId);
  return { config, profile, attestation };
}

async function account(connection: Connection, address: PublicKey, programId: PublicKey, name: string) {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(programId)) return null;
  if (!info.data.subarray(0, 8).equals(discriminator(name))) return null;
  return info.data;
}

export async function verifyPresence(connection: Connection, wallet: PublicKey, opts: VerifyOptions): Promise<PresenceResult> {
  const programId = opts.programId ?? PROGRAM_ID;
  const day = opts.day ?? Math.floor(Date.now() / 1000 / SECONDS_PER_DAY);
  const a = addresses(wallet, opts.mission, day, opts.seq ?? 0, programId);
  const [cfg, prof, att] = await Promise.all([
    account(connection, a.config, programId, "Config"),
    account(connection, a.profile, programId, "PresenceProfile"),
    account(connection, a.attestation, programId, "DailyAttestation"),
  ]);

  // PresenceProfile: owner(32) sgt(32) level(u8) reputation(u64) attestations(u64) streak(u32) best(u32) last_day(i64)
  const profile = prof
    ? { exists: true, level: prof[72], reputation: Number(prof.readBigUInt64LE(73)),
        attestations: Number(prof.readBigUInt64LE(81)), streak: prof.readUInt32LE(89) }
    : { exists: false, level: 0, reputation: 0, attestations: 0, streak: 0 };
  const fail = (reason: string): PresenceResult => ({ verified: false, reason, assuranceLevel: 0, profile });

  if (!cfg) return fail("program config not found");
  if (!att) return fail("no attestation for this wallet, mission and day");

  // DailyAttestation: profile(32) day(i64) mission(32) root(32) assurance(u8) attestor(32) recorded_at(i64)
  const attestor = new PublicKey(att.subarray(8 + 32 + 8 + 32 + 32 + 1, 8 + 32 + 8 + 32 + 32 + 1 + 32));
  const configured = new PublicKey(cfg.subarray(8 + 32, 8 + 64));
  const trusted = opts.trustedAttestors ?? [configured];
  if (!trusted.some((t) => t.equals(attestor))) return fail(`attestor ${attestor.toBase58()} is not trusted`);
  if (!new PublicKey(att.subarray(8, 40)).equals(a.profile)) return fail("attestation belongs to another profile");

  return {
    verified: true,
    assuranceLevel: att[8 + 32 + 8 + 32 + 32],
    evidenceRoot: Buffer.from(att.subarray(8 + 32 + 8 + 32, 8 + 32 + 8 + 32 + 32)).toString("hex"),
    attestation: a.attestation.toBase58(),
    attestor: attestor.toBase58(),
    recordedAt: Number(att.readBigInt64LE(8 + 32 + 8 + 32 + 32 + 1 + 32)),
    profile,
  };
}
