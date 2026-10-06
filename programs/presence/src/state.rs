use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const PROFILE_SEED: &[u8] = b"profile";
pub const ATTESTATION_SEED: &[u8] = b"attestation";
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Who may write attestations. Only the ATTEST engine's key can anchor a verified action.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub attestor: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]
pub struct ProfileStats {
    pub attestations: u64,
    pub current_streak: u32,
    pub best_streak: u32,
    /// UTC day number (unix_ts / 86400) of the latest attestation; -1 before the first.
    pub last_day: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PresenceProfile {
    pub owner: Pubkey,
    /// Seeker Genesis Token mint bound to this profile. Default pubkey = not bound
    /// (development mode, where SGT eligibility is bypassed off-chain).
    pub sgt_mint: Pubkey,
    /// Highest assurance level ever attested (1 = P1 ... 4 = P4).
    pub level: u8,
    /// Sum of assurance levels across attestations. Same rule the ATTEST engine uses.
    pub reputation: u64,
    pub stats: ProfileStats,
    pub bump: u8,
}

/// One per profile per UTC day. PDA uniqueness makes a second settlement for the same day fail.
#[account]
#[derive(InitSpace)]
pub struct DailyAttestation {
    pub profile: Pubkey,
    pub day: i64,
    /// SHA-256 of the mission id string.
    pub mission_id: [u8; 32],
    /// Commitment to the session's evidence chain. Raw evidence never goes on-chain.
    pub evidence_root: [u8; 32],
    pub assurance_level: u8,
    pub attestor: Pubkey,
    pub recorded_at: i64,
    pub bump: u8,
}
