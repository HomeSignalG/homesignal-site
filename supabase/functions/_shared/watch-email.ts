// THE WATCH EMAIL (Development Activity build step 9) — what the agent is told, and nothing else. PURE: it builds a subject, a plain-text body
// and an HTML body from the selection `selectForEmail` (property-watch.ts) made, and sends nothing.
//
// WHAT IS IN IT: the development records near a property the agent is watching whose official status changed, each with its name, kind, the
// change in the publisher's own words (from -> to), the date HomeSignal detected it and the official source's link; the report's number and
// date so the agent knows which property; one line saying how to stop.
//
// WHAT IS NEVER IN IT, by construction: the property's address, the client label, any coordinate, any distance or direction from the property
// (that would recover it), the agent's name or address, or a link that carries a token. The builder is not GIVEN any of those, so it cannot
// print them; test/property-watch-email.test.mjs hands it a unique marker for each and proves none appears, and a structural pin proves it
// names no private-layer reader. An email is sent to an outside service (the mail provider), so the property stays out of it: the agent opens
// the report in HomeSignal to see which property it is.
//
// EVERY PUBLISHER STRING IS UNTRUSTED TEXT. A project's name or stage comes from a government feed; in HTML it is escaped, in either part it is
// cut to a bounded length with control characters and line breaks removed, and a link is printed only if it is an https URL.
import type { EmailSelection, WatchChange, WatchEntry } from './property-watch.ts';

/** The one From address. noreply@: nobody reads replies, and the email says where to go instead. */
export const WATCH_FROM = 'HomeSignal <noreply@homesignal.net>';
/** Where the agent opens the report. The page is signed-in; no token and no private value rides in this address. */
export const WATCH_OPEN_URL = 'https://homesignal.net/development-activity-reports.html';

const VALUE_MAX = 160;

/** Publisher text made safe to print: one line, no control characters, no zero-width or bidirectional-override characters (they can reorder what a reader sees), bounded. */
export function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  const t = String(v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > VALUE_MAX ? t.slice(0, VALUE_MAX - 1).trimEnd() + '…' : t;
}

export function esc(v: unknown): string {
  return clean(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** An official link is printed only if it is an https URL with no credentials. */
export function safeLink(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') ? u.toString() : null;
  } catch { return null; }
}

const FIELD_WORDS: Record<string, string> = {
  stage: 'Stage', status: 'Status', date_kind: 'Official date', submitted_at: 'Date', name: 'Name', type: 'Type', type_raw: 'Type',
  address: 'Address', developer: 'Developer', size: 'Size', investment: 'Investment', start_date: 'Start date', end_date: 'End date', source_ref: 'Source link',
};
const fieldWord = (f: string): string => FIELD_WORDS[f] ?? clean(f).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const KIND_WORDS: Record<string, string> = {
  filed: 'Filed', issued: 'Issued', decided: 'Decided', awarded: 'Awarded', completed: 'Completed', hearing: 'Hearing', scheduled: 'Scheduled', estimated: 'Estimated',
};

const dayWords = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
};

const shown = (v: unknown): string => (clean(v) === '' ? 'not stated' : clean(v));

/** One line per change: what happened, in plain words. */
function entryLines(e: WatchEntry): string[] {
  const when = dayWords(e.detected_at);
  const head = e.event_type === 'first_detected' ? 'New official record' : 'Official status changed';
  const lines = [head + (when ? ' (found ' + when + ')' : '')];
  for (const c of e.changes.slice(0, 6)) lines.push(fieldWord(c.field) + ': ' + shown(c.from) + ' → ' + shown(c.to));
  if (e.event_type === 'first_detected' && e.changes.length === 0) lines.push('A record near the property that HomeSignal had not seen before.');
  if (e.publisher_event && e.publisher_event.kind) {
    const k = KIND_WORDS[e.publisher_event.kind] ?? clean(e.publisher_event.kind);
    const d = e.publisher_event.date ? ' ' + clean(e.publisher_event.date) : '';
    lines.push('The source records it as: ' + k + d);
  }
  return lines;
}

export type EmailInput = {
  selection: EmailSelection;
  /** one or more official sources near the property could not be fully read recently */
  partial: boolean;
  /** the stored report this watch began from: its number (1 = the brokerage's first) and issue time */
  reportNumber: number | null;
  reportDate: string;
};
export type Email = { subject: string; text: string; html: string };

export function composeWatchEmail(i: EmailInput): Email {
  const { listed, remaining } = i.selection;
  const total = listed.reduce((n, c) => n + c.entries.length, 0) + remaining.entries;
  const subject = 'HomeSignal: ' + total + ' official development change' + (total === 1 ? '' : 's') + ' near a property you are watching';
  const which = (i.reportNumber !== null ? 'Report ' + i.reportNumber : 'Your saved report') + (dayWords(i.reportDate) ? ', made ' + dayWords(i.reportDate) : '');
  const intro = 'Development records near a property you are watching have changed. The property is the one in ' + which + '. Open that report in HomeSignal to see which property it is.';
  const partialLine = 'One or more official sources near this property could not be fully read recently, so there may be changes HomeSignal has not seen yet.';
  const moreLine = remaining.entries > 0 ? remaining.entries + ' more change' + (remaining.entries === 1 ? '' : 's') + ' will be in your next email.' : '';
  const stop = 'You get this because you chose to watch this property in HomeSignal. To stop, open the report in HomeSignal and choose Stop watching.';
  const source = 'Each change comes from the official source named under it. HomeSignal shows what the source states and when HomeSignal found it; it is not a legal opinion.';

  const textBlocks = listed.map((c) => projectText(c));
  const text = [
    intro, '', ...textBlocks.flatMap((b) => [...b, '']),
    ...(moreLine ? [moreLine, ''] : []), ...(i.partial ? [partialLine, ''] : []),
    'Open the report: ' + WATCH_OPEN_URL, '', source, stop,
  ].join('\n');

  const html = '<!doctype html><html><body style="margin:0;padding:0;background:#f5f4f1;">'
    + '<div style="max-width:620px;margin:0 auto;padding:20px 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2a30;line-height:1.5;">'
    + '<p style="margin:0 0 14px;font-size:15px;">' + esc(intro) + '</p>'
    + listed.map((c) => projectHtml(c)).join('')
    + (moreLine ? '<p style="margin:14px 0 0;font-size:14px;">' + esc(moreLine) + '</p>' : '')
    + (i.partial ? '<p style="margin:14px 0 0;font-size:14px;color:#8a5a00;">' + esc(partialLine) + '</p>' : '')
    + '<p style="margin:18px 0 0;"><a href="' + WATCH_OPEN_URL + '" style="display:inline-block;padding:10px 16px;background:#0b5c6b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;">Open the report</a></p>'
    + '<p style="margin:18px 0 0;font-size:12.5px;color:#55656c;">' + esc(source) + '</p>'
    + '<p style="margin:8px 0 0;font-size:12.5px;color:#55656c;">' + esc(stop) + '</p>'
    + '</div></body></html>';
  return { subject, text, html };
}

function titleOf(c: WatchChange): string {
  const t = c.type && typeof c.type === 'object' ? clean((c.type as { label?: unknown }).label) : '';
  return (clean(c.name) || 'Development record') + (t ? ' · ' + t : '');
}

function projectText(c: WatchChange): string[] {
  const link = safeLink(c.source.url);
  const out = [titleOf(c)];
  for (const e of c.entries) for (const l of entryLines(e)) out.push('  ' + l);
  if (link) out.push('  Official source: ' + link);
  if (c.source.attribution) out.push('  ' + clean(c.source.attribution));
  return out;
}

function projectHtml(c: WatchChange): string {
  const link = safeLink(c.source.url);
  return '<div style="margin:0 0 12px;padding:12px 14px;background:#ffffff;border:1px solid #d9d6cf;border-radius:8px;">'
    + '<p style="margin:0 0 6px;font-size:15.5px;font-weight:600;">' + esc(titleOf(c)) + '</p>'
    + c.entries.map((e) => {
      const ls = entryLines(e);
      return '<p style="margin:0 0 6px;font-size:14px;"><strong>' + esc(ls[0]) + '</strong>'
        + ls.slice(1).map((l) => '<br>' + esc(l)).join('') + '</p>';
    }).join('')
    + (link ? '<p style="margin:0;font-size:13.5px;"><a href="' + esc(link) + '" style="color:#0b5c6b;">Official source</a>'
      + (c.source.attribution ? ' · ' + esc(c.source.attribution) : '') + '</p>'
      : (c.source.attribution ? '<p style="margin:0;font-size:13.5px;">' + esc(c.source.attribution) + '</p>' : ''))
    + '</div>';
}
