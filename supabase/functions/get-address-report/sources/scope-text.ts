// THE SOURCE'S OWN WORK DESCRIPTION (column_map.scope_text), shared by every connector so they carry it the same way.
//
// Why: the report's relevance rule (supabase/functions/_shared/national-report.ts `relevance`) reads `scope_text` beside the title. Many
// publishers put the work description in a column the title never read (Brunswick NC `Description`, Durham `DESCRIPTION`, Cleveland
// `WORK_DESCRIPTION`, Sioux Falls `WORKCLASS`, San Jose and Arlington TX `WORKDESC`), so their records could not be judged and were left
// out as "relevance not established" (docs/report-quality-national7-2026-11-02.md). The ledger does not judge `scope_text`
// (docs/dev-change-ledger.sql lists it as noise), so adding it to a source does not create change events.
//
// What is kept: the publisher's words, whitespace collapsed, cut at a word at SCOPE_TEXT_CAP characters. What is never kept: an email
// address or an account name ("User: jane.doe"), which some description fields carry. A description the record's label already shows in full is dropped.
export const SCOPE_TEXT_CAP = 300;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ACCOUNT = /\bUser\s*:\s*\S+/gi;

export function scopeTextOf(raw: unknown, title: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let t = String(raw).replace(EMAIL, ' ').replace(ACCOUNT, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > SCOPE_TEXT_CAP) {
    const cut = t.slice(0, SCOPE_TEXT_CAP), sp = cut.lastIndexOf(' ');
    t = (sp > SCOPE_TEXT_CAP * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—•]+$/, '') + '…';
  }
  // nothing more than the record's label (the title as the connectors store it, cut at 120): a longer description is kept, even when the title
  // is that same text, because the label is where the cut happened (Seattle's Bumbershoot permit: the dates are past character 120)
  const label = String(title ?? '').trim().slice(0, 120).trim().toLowerCase();
  if (label.includes(t.toLowerCase())) return null;
  return t;
}

/** The field to spread into a connector's record: `{ scope_text }`, or nothing when the source states no description. */
export function scopeField(raw: unknown, title: string): { scope_text?: string } {
  const st = scopeTextOf(raw, title);
  return st ? { scope_text: st } : {};
}
