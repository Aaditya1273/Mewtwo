pub mod state;

use anchor_lang::prelude::*;

pub use state::*;

declare_id!("CFZsFPtvwo5KDenV3qgorroaRmT7NuYsfPnd4avFS2cT");

#[error_code]
pub enum PresenceError {
    #[msg("Signer is not the configured ATTEST attestor")]
    UnauthorizedAttestor,
    #[msg("Assurance level must be 1..=4")]
    InvalidAssurance,
    #[msg("Attestation day must be today or yesterday (UTC)")]
    DayOutOfRange,
    #[msg("Profile is bound to a different Seeker Genesis Token")]
    SgtMismatch,
}

#[program]
pub mod presence {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, attestor: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.attestor = attestor;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn record_attestation(
        ctx: Context<RecordAttestation>,
        day: i64,
        mission_id: [u8; 32],
        evidence_root: [u8; 32],
        assurance_level: u8,
        sgt_mint: Pubkey,
        seq: u8,
    ) -> Result<()> {
        // `seq` is the claim index for this mission today (0 for one-per-day missions).
        // Each (profile, mission, day, seq) can be attested exactly once.
        let _ = seq;
        require!((1..=4).contains(&assurance_level), PresenceError::InvalidAssurance);
        let now = Clock::get()?.unix_timestamp;
        let today = now.div_euclid(SECONDS_PER_DAY);
        require!(day == today || day == today - 1, PresenceError::DayOutOfRange);

        let profile = &mut ctx.accounts.profile;
        if profile.owner == Pubkey::default() {
            profile.owner = ctx.accounts.owner.key();
            profile.bump = ctx.bumps.profile;
            profile.stats.last_day = -1;
        }
        if profile.sgt_mint == Pubkey::default() {
            profile.sgt_mint = sgt_mint;
        } else {
            require_keys_eq!(profile.sgt_mint, sgt_mint, PresenceError::SgtMismatch);
        }

        let stats = &mut profile.stats;
        stats.current_streak = match day - stats.last_day {
            0 => stats.current_streak, // another claim on a day already counted
            1 => stats.current_streak + 1,
            _ => 1,
        };
        stats.best_streak = stats.best_streak.max(stats.current_streak);
        stats.last_day = stats.last_day.max(day);
        stats.attestations += 1;
        profile.level = profile.level.max(assurance_level);
        profile.reputation += assurance_level as u64;

        let att = &mut ctx.accounts.attestation;
        att.profile = profile.key();
        att.day = day;
        att.mission_id = mission_id;
        att.evidence_root = evidence_root;
        att.assurance_level = assurance_level;
        att.attestor = ctx.accounts.attestor.key();
        att.recorded_at = now;
        att.bump = ctx.bumps.attestation;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: i64, mission_id: [u8; 32], evidence_root: [u8; 32], assurance_level: u8, sgt_mint: Pubkey, seq: u8)]
pub struct RecordAttestation<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump,
              has_one = attestor @ PresenceError::UnauthorizedAttestor)]
    pub config: Account<'info, Config>,
    /// The ATTEST engine key; pays rent so users never need SOL to be attested.
    #[account(mut)]
    pub attestor: Signer<'info>,
    /// CHECK: the wallet the attestation is about. Its identity was verified off-chain (SIWS).
    pub owner: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = attestor, space = 8 + PresenceProfile::INIT_SPACE,
              seeds = [PROFILE_SEED, owner.key().as_ref()], bump)]
    pub profile: Account<'info, PresenceProfile>,
    #[account(init, payer = attestor, space = 8 + DailyAttestation::INIT_SPACE,
              seeds = [ATTESTATION_SEED, profile.key().as_ref(), &mission_id, &day.to_le_bytes(), &[seq]], bump)]
    pub attestation: Account<'info, DailyAttestation>,
    pub system_program: Program<'info, System>,
}
