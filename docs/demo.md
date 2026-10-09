# Demo script (about 3 minutes)

Setup: `scripts/dev_stack.sh` (local validator, program, SKR_TEST pools funded by a sponsor wallet, ATTEST in
development mode), plus an emulator or phone with Solana Mobile's `fakewallet-v1-debug.apk`
([mobile-wallet-adapter releases](https://github.com/solana-mobile/mobile-wallet-adapter/releases)) and the PRESENCE APK.
For devnet instead: `scripts/devnet_setup.sh`, start ATTEST with `.devnet/attest.env`, then `scripts/fund_pool.sh`.

| # | Show | Say |
|---|---|---|
| 1 | `GET /sponsor/pools`: 50 SKR-TEST in the ASHA pool, 100 in cold chain | "Sponsors fund outcomes, not installs. These deposits were read back from chain before being credited." |
| 2 | App home: Presence Passport, two missions | "One Seeker, one identity. Each mission says what it proves and what it pays." |
| 3 | Connect wallet → MWA authorize | "Standard Mobile Wallet Adapter; on Seeker this is Seed Vault." |
| 4 | ASHA Village Visit → consent → Start → wallet signs | "The wallet signs a one-time server code that also binds this session's device key." |
| 5 | Active session: blocks seal, answer "Still here?" | "Every 10 seconds a signed checkpoint is chained to the last; the server times it, not the phone." |
| 6 | Verifying → Trust Receipt: VERIFIED, +0.5 SKR-TEST, QR | "Attestation and payment were one Solana transaction. The QR opens it in the explorer." |
| 7 | Home: ASHA ✓ 1/1, Cold-Chain 0/3 | "One ASHA claim per device per day; cold chain allows three handovers." |
| 8 | Leave the app mid-session → NOT VERIFIED `session left foreground` | "The server rejects it, and says exactly why." |
| 9 | `verifyPresence()` on the wallet → `verified: true, assuranceLevel: 2` | "Any NGO or app can check this on-chain without trusting us." |

Be upfront on camera: **development mode** means Seeker Genesis Token eligibility was bypassed on this device (it
is not a Seeker); the check itself runs in production mode. Missions don't prove location. Sponsors are illustrative.

Automated version of steps 2–8 on a USB device or emulator:
`python3 scripts/device_e2e.py <adb-serial> happy cargo again leave`
