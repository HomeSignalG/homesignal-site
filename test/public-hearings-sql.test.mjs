// Pins docs/public-hearings.sql to the rules in homesignal-ingest hearings.py (not executed against a database).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const sql = readFileSync(new URL('../docs/public-hearings.sql', import.meta.url), 'utf8');
const code = sql.replace(/--.*$/gm, '');
assert.match(sql, /NOT APPLIED/);
assert.doesNotMatch(code, /\bdrop (table|column)\b|\balter column\b.*\bdrop not null\b|\bdelete from\b/i);
assert.match(code, /announced_on < current_date - 365 then 'unresolved'/);
assert.match(code, /announced_on < current_date - 30 then 'provisional_expired'/);
assert.match(code, /'posting_date_fallback'/);
for (const t of ['meeting_reconciliation','meeting_project_link','hearing_source_evidence','hearing_notification_event'])
  assert.match(code, new RegExp(t));
assert.match(code, /revoke all on public\.%I from public, anon, authenticated/);
assert.match(code, /hearing_public_date/);
// the public date function must withhold the placeholder
assert.match(code, /date_basis in \('vendor_event','stated_in_notice','stated_in_title'\)\s*then m\.meeting_date::date end/);
console.log('public-hearings-sql: ok');
