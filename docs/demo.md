# Demo script (about 3 minutes)

Setup: `scripts/dev_stack.sh` (local validator, program, SKR_TEST pools seeded by a sponsor wallet, ATTEST in
development mode), an emulator or phone with Solana Mobile's `fakewallet-v1-debug.apk`, and the PRESENCE APK.

| # | Show | Say |
|---|---|---|
| 1 | Home: passport, streak, Clock In cards with pool sizes | "Every Seeker owner knows the loop: pick up the phone for one thing, lose twenty minutes." |
| 2 | Connect wallet → MWA authorize | "New test wallets get test SKR from a dev-only faucet." |
| 3 | Quick Clock-In → rules, guarantees, consent → *Stake 1 & clock in* | "Skin in the game: finish and you get it back plus 20%. Quit and it funds everyone who finished." |
| 4 | Wallet: sign message, sign transaction | "One wallet session signs the sign-in and the stake; the server only submits the exact stake it issued." |
| 5 | Session: ring timer, evidence blocks sealing, phone buzzes → *I'm here* | "Focus apps run on a local timer, so you can't put money on them. Here the server keeps time, and checks for a human at random moments." |
| 6 | Receipt: VERIFIED, *1 SKR-TEST stake back + 0.2 bonus*, QR | "Attestation and payout are one Solana transaction. Scan it." |
| 7 | Second run: leave the app → NOT VERIFIED, *your stake went to the pool* | "Quitters fund finishers. That's the whole economy." |
| 8 | `GET /sponsor/pools` or the pool line on Home grows | "The pool is real tokens in a real account." |

Say plainly on camera: development mode (this device isn't a Seeker, so Seeker eligibility is bypassed and labeled);
SKR-TEST is a valueless test mint. The mainnet switch is pointing `REWARD_MINT` at SKR.

Automated version on a USB device or emulator: `python3 scripts/device_e2e.py <adb-serial> happy leave`
