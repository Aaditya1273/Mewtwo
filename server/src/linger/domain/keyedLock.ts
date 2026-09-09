/**
 * A per-key async mutex.
 *
 * Colyseus dispatches messages in order, but every LINGER handler is `async` and yields at
 * its first `await`. Two messages that arrive close together therefore interleave, and
 * check-then-write sequences are not safe:
 *
 *   interact:    hasInteracted()      -> await -> (yield) -> createInteraction()
 *   createBond:  findBond()           -> await -> (yield) -> createBond()
 *   createEcho:  latestEchoByOwner()  -> await -> (yield) -> createEcho()
 *
 * Two taps on the same Echo in the same tick, or two clients qualifying for the same Bond
 * on the same server tick, both pass their duplicate check before either writes. The
 * result is a doubled interaction count, or two Bond records for one pair.
 *
 * Serialising on a key closes all three. Critical sections are microseconds of in-memory
 * work, so contention is not a concern.
 *
 * ponytail: single-process lock. If LINGER is ever run as more than one server process
 * against shared storage, this must become a storage-level unique constraint or a
 * distributed lock — a Map in one process cannot protect the others.
 */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>()

  /** Run `fn` with exclusive access to `key`. Different keys run concurrently. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()

    // Chain off the previous holder, running `fn` whether it settled or threw — one
    // caller's failure must not deadlock everyone queued behind it on the same key.
    const result = previous.then(fn, fn)

    // The stored tail must never reject, or an unhandled rejection escapes while the
    // next caller has not attached yet.
    const tail = result.catch(() => undefined)
    this.tails.set(key, tail)

    try {
      return await result
    } finally {
      // Clear only if nobody queued behind us, so the map does not grow without bound.
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }

  /** Keys currently held. Test-only visibility. */
  get size(): number {
    return this.tails.size
  }
}
