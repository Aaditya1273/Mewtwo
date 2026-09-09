# LINGER — Mobile Smoke Test

A manual checklist to run on a real phone before a demonstration.

**Nothing in this file is a claim about performance.** LINGER has not been profiled on a
physical device, and no frame rate is asserted anywhere in this repository. This is a list
of things to *check*, not a record of things already verified. Fill in the results column
when you run it.

---

## Before you start

| | |
|---|---|
| Server running | `cd server && npm start` |
| Scene deployed or previewing | `cd scene && npm start` (preview) |
| Devices | at least one phone; two for the Bond and multiplayer rows |
| Same realm | **critical** — see [Two-device setup](#two-device-setup) |

Tap the small connection dot at the top of the screen to open the developer diagnostic. It
reports World, realm, server status, session id, whether you are signed in, and the live
player count. Two devices must show **the same realm** or they will never see each other.

---

## 1. First load

| # | Check | Expected | Result |
|---|---|---|---|
| 1.1 | Open the World on the phone | The sanctuary appears; ground, Hearth and Echo ring are all visible | |
| 1.2 | Time to something on screen | The World is drawn before the server answers — it is built synchronously | |
| 1.3 | Loading with the server stopped | The World still loads and is walkable; connection dot is hollow | |
| 1.4 | Genesis Echoes present | Five amber figures around the ring | |
| 1.5 | Amber vs blue | Genesis Echoes are visibly warmer than any real visitor Echo | |
| 1.6 | Spawn position | You arrive at the entry portal, facing the Hearth | |
| 1.7 | Orientation on arrival | The Hearth is straight ahead without turning | |

## 2. Touch movement

| # | Check | Expected | Result |
|---|---|---|---|
| 2.1 | Walk with the virtual joystick | Movement is unobstructed | |
| 2.2 | Joystick zone is clear | No LINGER UI sits in the lower third of the screen | |
| 2.3 | Action-button zone is clear | Nothing of ours in the bottom-right | |
| 2.4 | Walk a full circuit of the ring | No UI blocks the view or intercepts a drag | |
| 2.5 | Camera drag | Look around freely; no LINGER element steals the gesture | |

## 3. Hearth interaction

| # | Check | Expected | Result |
|---|---|---|---|
| 3.1 | Walk toward the Hearth | *"Sit & Linger"* appears on entering the radius | |
| 3.2 | Prompt readability | Legible at arm's length in daylight | |
| 3.3 | Stay put | The progress bar fills over ~20 s | |
| 3.4 | Hearth responds | The fire brightens as the bar fills | |
| 3.5 | Walk out early | Prompt clears and progress resets — no partial credit | |
| 3.6 | Complete a full linger | *"You left an Echo here."* | |
| 3.7 | Your Echo appears | A new cool-blue figure on the ring | |
| 3.8 | Linger again immediately | Refused with a plain cooldown message, not silence | |
| 3.9 | Understandable without instruction | A first-time user works out the mechanic unaided | |

## 4. Echo interaction

| # | Check | Expected | Result |
|---|---|---|---|
| 4.1 | Tap an Echo | The action card opens | |
| 4.2 | Tap accuracy | The Echo body is easy to hit while walking past | |
| 4.3 | No precision aiming needed | A rough thumb tap is enough | |
| 4.4 | Tap the head or the label | These are not tap targets and do not steal the tap | |
| 4.5 | Genesis card | Reads *"Genesis Echo · LINGER Founding Visitor"* | |
| 4.6 | Real visitor card | Shows their name and how long ago | |

## 5. Echo card

| # | Check | Expected | Result |
|---|---|---|---|
| 5.1 | Card position | Sits in the middle band, clear of the joystick | |
| 5.2 | Three actions visible | Heart, High-five, Note — nothing else | |
| 5.3 | Touch targets | Each at least 64 px tall; no mis-taps between neighbours | |
| 5.4 | Text size | Name and subtitle readable without squinting | |
| 5.5 | "Not now" | Closes without acting | |
| 5.6 | Tap outside the card | Does not trigger anything behind it | |

## 6. Heart

| # | Check | Expected | Result |
|---|---|---|---|
| 6.1 | Tap Heart | *"You left a Heart."* | |
| 6.2 | Card confirms | *"They will know you were here."* | |
| 6.3 | Echo brightens | The Echo becomes slightly more present | |
| 6.4 | Tap Heart again on the same Echo | Refused — one action per opening | |
| 6.5 | Heart your own Echo | Refused with *"That Echo is yours."* | |

## 7. High-five

| # | Check | Expected | Result |
|---|---|---|---|
| 7.1 | Tap High-five | *"You high-fived their Echo."* | |
| 7.2 | Both marks | An Echo with both shows ♥ and ✋ on its label | |
| 7.3 | Read Note | Shows the note, or *"They left no words."* | |

## 8. Bond (two devices)

| # | Check | Expected | Result |
|---|---|---|---|
| 8.1 | Both diagnostics show the same realm | **Verify before anything else** | |
| 8.2 | Each device sees the other's avatar | Native Decentraland comms | |
| 8.3 | Walk within ~4 m | *"<name> is here"* appears | |
| 8.4 | Wave button appears | Large, above the reserved zone | |
| 8.5 | One waves | Other sees *"<name> waved at you"* | |
| 8.6 | Both waved | *"Stay with <name> a little longer..."* | |
| 8.7 | Stay together ~30 s | Bond celebration card on **both** devices | |
| 8.8 | Card content | Both names, `Bond #0001` | |
| 8.9 | Bond stone appears | Near the Hearth, visible to both | |
| 8.10 | Walk apart mid-qualification | No Bond forms; the clock resets | |
| 8.11 | Try to Bond the same pair again | Refused as a duplicate | |

## 9. Return panel

| # | Check | Expected | Result |
|---|---|---|---|
| 9.1 | Leave an Echo, quit the World | | |
| 9.2 | Other device interacts with it | | |
| 9.3 | Re-enter on the first device | *"WHILE YOU WERE AWAY"* after ~4 s, not during the load | |
| 9.4 | Counts are correct | Matches what the other device actually did | |
| 9.5 | Dismiss | *"The World remembered me"* closes it | |
| 9.6 | Re-enter again | Nothing — the same activity never repeats | |
| 9.7 | Signed in? | **Requires a wallet.** A guest gets a new identity each session and has no return activity. See §12 | |

## 10. Reconnect

| # | Check | Expected | Result |
|---|---|---|---|
| 10.1 | Enable flight mode briefly | Connection dot goes hollow | |
| 10.2 | Restore connectivity | Reconnects on its own | |
| 10.3 | While disconnected | The World stays walkable; Echoes still visible | |
| 10.4 | Linger while disconnected | Refused with *"your Echo was not saved"* — never a silent loss | |
| 10.5 | Restart the server | Client recovers; *"The Hearth was rekindled. You can linger again."* | |
| 10.6 | After a restart | You can leave a new Echo — not locked out | |

## 11. Screen sizes, orientation, readability

| # | Check | Expected | Result |
|---|---|---|---|
| 11.1 | Small phone (~5.5") | No text clipped; cards fit | |
| 11.2 | Large phone (~6.7") | Layout does not look stranded | |
| 11.3 | Tablet | Cards stay centred and capped at 460 px | |
| 11.4 | Portrait | All UI reachable | |
| 11.5 | Landscape | Cards clear of the reserved bottom band | |
| 11.6 | Rotate mid-interaction | Open card survives the rotation | |
| 11.7 | Notch / dynamic island | Top band not obscured | |
| 11.8 | Bright daylight | Warmth bar and prompt still legible | |
| 11.9 | Long display name | Truncates at 40 characters, no overflow | |
| 11.10 | Longest note (140 chars) | Fits the card without clipping | |

## 12. Identity

| # | Check | Expected | Result |
|---|---|---|---|
| 12.1 | Open the diagnostic | Shows `identity wallet (signature verified)` or `guest` | |
| 12.2 | Signed in with a wallet | Return activity works across sessions | |
| 12.3 | Guest (no wallet) | Can linger, leave Echoes and interact; **no return activity** — a guest is a new person each session, by design | |

---

## Two-device setup

Decentraland can place two people on **different realms (islands)** of the same World. Two
people on different realms get different live rooms: they cannot see each other, cannot
wave, and cannot form a Bond. Persistent Echoes and Bonds are shared across realms; live
presence is not.

Before demonstrating anything multiplayer:

1. Open the diagnostic on both devices (tap the connection dot).
2. Compare the **realm** line. They must match exactly.
3. If they differ, have the second device join through the **same link** as the first, or
   rejoin until the realms match.

LINGER does not fake cross-realm synchronisation. If the realms differ, the two devices
genuinely are in different live rooms and the diagnostic tells you so.

---

## Recording results

Note the device, OS version, and Decentraland client build alongside the table. If
anything in §1–§7 fails, the single-player judge path is broken and takes priority over
everything else.

**If asked about frame rate:** it has not been measured. Say that, and point at
[`PERFORMANCE.md`](./PERFORMANCE.md), which lists the entity budget and the optimisation
decisions that were actually made.
