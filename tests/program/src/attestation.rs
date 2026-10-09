//! Runs against the local validator started by `anchor test`.
use anchor_client::{Client, Cluster, CommitmentConfig};
use presence::{DailyAttestation, PresenceProfile, ATTESTATION_SEED, CONFIG_SEED, PROFILE_SEED};
use solana_keypair::{read_keypair_file, Keypair};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::time::{SystemTime, UNIX_EPOCH};

fn today() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 / 86_400
}

#[test]
fn attestation_lifecycle() {
    let payer = read_keypair_file(std::env::var("ANCHOR_WALLET").unwrap()).unwrap();
    let client = Client::new_with_options(Cluster::Localnet, &payer, CommitmentConfig::confirmed());
    let program = client.program(presence::ID).unwrap();
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &presence::ID).0;

    // The test wallet plays the ATTEST engine.
    let config = pda(&[CONFIG_SEED]);
    program.request()
        .accounts(presence::accounts::InitializeConfig {
            admin: payer.pubkey(), config, system_program: solana_sdk_ids::system_program::id() })
        .args(presence::instruction::InitializeConfig { attestor: payer.pubkey() })
        .send().expect("initialize_config");

    let owner = Keypair::new().pubkey();
    let profile = pda(&[PROFILE_SEED, owner.as_ref()]);
    let day = today();
    let mission = [7u8; 32];
    let att_pda = |day: i64, seq: u8| pda(&[ATTESTATION_SEED, profile.as_ref(), &mission, &day.to_le_bytes(), &[seq]]);
    let record_seq = |signer: &Keypair, day: i64, assurance: u8, seq: u8| {
        let req = program.request()
            .accounts(presence::accounts::RecordAttestation {
                config, attestor: signer.pubkey(), owner, profile,
                attestation: att_pda(day, seq),
                system_program: solana_sdk_ids::system_program::id() })
            .args(presence::instruction::RecordAttestation {
                day, mission_id: mission, evidence_root: [9; 32],
                assurance_level: assurance, sgt_mint: Pubkey::default(), seq });
        // The client payer signs automatically; adding it again is a TooManySigners error.
        if signer.pubkey() == payer.pubkey() { req.send() } else { req.signer(signer).send() }
    };
    let record = |signer: &Keypair, day: i64, assurance: u8| record_seq(signer, day, assurance, 0);

    // Rejections: wrong signer, bad assurance, backdated day.
    let impostor = Keypair::new();
    assert!(record(&impostor, day, 2).is_err(), "non-attestor must be rejected");
    assert!(record(&payer, day, 0).is_err(), "assurance 0 must be rejected");
    assert!(record(&payer, day - 5, 2).is_err(), "old day must be rejected");

    // Yesterday then today: streak 2, reputation 4.
    record(&payer, day - 1, 2).expect("record yesterday");
    record(&payer, day, 2).expect("record today");

    let p: PresenceProfile = program.account(profile).unwrap();
    assert_eq!(p.owner, owner);
    assert_eq!(p.stats.attestations, 2);
    assert_eq!(p.stats.current_streak, 2);
    assert_eq!(p.stats.last_day, day);
    assert_eq!(p.reputation, 4);
    assert_eq!(p.level, 2);

    let a: DailyAttestation = program.account(att_pda(day, 0)).unwrap();
    assert_eq!(a.evidence_root, [9; 32]);
    assert_eq!(a.assurance_level, 2);
    assert_eq!(a.attestor, payer.pubkey());

    // Double settlement: the same (profile, mission, day, seq) PDA cannot be created twice.
    assert!(record(&payer, day, 2).is_err(), "second attestation of the same claim must fail");

    // A second claim slot on the same day (multi-claim missions) lands, without inflating the streak.
    record_seq(&payer, day, 2, 1).expect("second claim slot");
    let p: PresenceProfile = program.account(profile).unwrap();
    assert_eq!((p.stats.attestations, p.stats.current_streak), (3, 2));
}
