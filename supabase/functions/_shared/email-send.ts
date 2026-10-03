// SENDING ONE EMAIL through the mail provider (Resend) — the same provider, the same From domain and the same project secret the pipeline-health
// alert already uses (supabase/functions/notify-health, in homesignal-ingest). One adapter, no second mail service, no new account.
//
// PURE of environment and network: the API key and `fetch` arrive as arguments. The key goes only to api.resend.com, never into a log, an error
// message or a response. A failed send is `EmailFailed` with a fixed reason (a status code or the word "network"), never the provider's body:
// the provider echoes the recipient and the message back in errors.
//
// EXACTLY-ONCE, as far as a retry allows: every send carries an Idempotency-Key derived from what is being told (see `idempotencyKeyFor`). The
// provider answers a repeat of the same key with the first result instead of sending again, so a run that sent the email and then died before
// recording it does not send it twice on the retry (within the provider's window of 24 hours; the daily job retries within the hour).
import type { FetchFn } from './service-rest.ts';

export class EmailFailed extends Error {}

export const RESEND_URL = 'https://api.resend.com/emails';

export type Message = { from: string; to: string; subject: string; text: string; html: string };

const ADDRESS = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
export const isMailable = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && ADDRESS.test(v);

/** Hex SHA-256 of a string. */
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The same watch told the same changes always gets the same key; a different set of changes gets a different one. */
export async function idempotencyKeyFor(watchId: string, told: Array<{ project_id: string; event_type: string; observed_at: string }>): Promise<string> {
  const lines = told.map((t) => t.project_id + '|' + t.event_type + '|' + Date.parse(t.observed_at)).sort();
  return 'watch-' + (await sha256Hex(watchId + '\n' + lines.join('\n')));
}

export async function sendEmail(fetchFn: FetchFn, apiKey: string, m: Message, idempotencyKey: string): Promise<void> {
  if (!apiKey) throw new EmailFailed('no key');
  if (!isMailable(m.to)) throw new EmailFailed('recipient');
  let r: Response;
  try {
    r = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
  } catch { throw new EmailFailed('network'); }
  if (!r.ok) throw new EmailFailed('http ' + r.status);
}
