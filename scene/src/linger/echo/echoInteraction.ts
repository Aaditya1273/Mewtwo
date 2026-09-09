import { InteractionType } from '../types/linger'
import { applyLocalInteraction, getEcho } from './echoSystem'
import { onEchoAction, EchoAction } from '../ui/panels'
import { openEchoCard, ui } from '../ui/state'
import { toast } from '../ui/root'

/**
 * Tap an Echo → show the action card → act → persist.
 *
 * Local feedback is applied immediately and the server call is fire-and-forget from the
 * player's point of view. If the server rejects the interaction it broadcasts the true
 * Echo state, which overwrites the optimistic update — so a rejected action self-corrects
 * without ever making the player wait.
 */

export type InteractionSender = (echoId: string, type: InteractionType) => void

/** Replaced by the network layer once connected. Until then interactions stay local. */
let send: InteractionSender = () => {}

export function setInteractionSender(sender: InteractionSender) {
  send = sender
}

export function handleEchoTap(echoId: string) {
  const echo = getEcho(echoId)
  if (!echo) return
  // Ignore taps while another overlay is up, so a stray tap behind a modal does nothing.
  if (ui.overlay !== 'none') return
  openEchoCard(echo)
}

function act(action: EchoAction) {
  const card = ui.echoCard
  if (!card) return
  // One action per opening of the card. Prevents double-tap spam at the source.
  if (card.acted !== '') return

  card.acted = action

  const echo = getEcho(card.echoId)
  if (!echo) return

  applyLocalInteraction(card.echoId, action)
  send(card.echoId, action)

  if (action === 'heart') toast('You left a Heart.')
  else if (action === 'highfive') toast('You high-fived their Echo.')
  else if (!echo.note) toast('They left no words.')
}

export function initEchoInteraction() {
  onEchoAction(act)
}
