/**
 * The "are you sure" on re-signing, and its snooze.
 *
 * A signature on a checklist or a delivery slip is the record that someone
 * checked, or that the customer received. One tap on Re-sign wiped it - at
 * the tailgate, on a phone, with a thumb - and nothing asked. So Re-sign now
 * asks, and a person who is fixing five signatures in a row can say "I know
 * what I'm doing" once and not be asked again for five minutes. The snooze
 * is per browser tab (sessionStorage), so it does not outlive the sitting.
 */
const KEY = 'sign.resign.until'
export const RESIGN_SNOOZE_MS = 5 * 60 * 1000

function read(): number {
  try { return Number(sessionStorage.getItem(KEY) ?? 0) } catch { return 0 }
}

/** Whether Re-sign may go ahead without asking, right now. */
export function resignSnoozed(now = Date.now()): boolean {
  return read() > now
}

/** Stop asking until `ms` from now. */
export function snoozeResign(ms = RESIGN_SNOOZE_MS, now = Date.now()) {
  try { sessionStorage.setItem(KEY, String(now + ms)) } catch { /* private mode: asks every time */ }
}

/** How much of the snooze is left, in whole minutes, for the footer to say. */
export function resignSnoozeLeftMin(now = Date.now()): number {
  return Math.max(0, Math.ceil((read() - now) / 60_000))
}
