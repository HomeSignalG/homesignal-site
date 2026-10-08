// The Local News topic sub-check in scripts/verify-alerts-page.mjs. No browser, and the
// network is passed in as `fetchImpl`, so every outcome can be tested offline.
//
// ── WHY IT CAN BE UNMEASURABLE ───────────────────────────────────────────────────────────
// The sub-check needs `alerts.subtopics`, and it reads with the public key from config.js.
// On 2026-09-26 migration `phase3_revoke_anon_alerts_after_site_swap` removed the public
// key's read of `public.alerts`; the site now reads `public.alerts_public`, which leaves
// `subtopics` out on purpose. No table the public key can read carries the topic tags
// (`app_changes` has no topic column either), so from here the rule cannot be measured.
// Before this module the refusal (HTTP 401) was an uncaught throw, and it stopped every
// page check that runs after it.
//
// ── WHO ENFORCES THE RULE ────────────────────────────────────────────────────────────────
// `public.app_refresh_zip` refuses to render an untagged Local News row, and
// homesignal-ingest's `check_local_news_rendered_topics.py` (daily, with read access)
// checks every rendered row against its backing alert. This sub-check is a report-only
// observer of the same rule on a handful of ZIPs; it decides nothing.
//
// ── THE OUTCOMES ─────────────────────────────────────────────────────────────────────────
//   read OK            -> measured; untagged rows are INFO, or FAIL when enforced
//   401 / 403          -> NOT MEASURED, said out loud; FAIL when enforced, because an
//                         enforced gate that could not read has not passed
//   any other failure  -> throw, as before (a server or network fault, not a permission)

export const TOPIC_RULE_OWNER =
  "homesignal-ingest check_local_news_rendered_topics.py (daily)";

/** Read source_url -> "has >=1 subtopic" for every local_news alert.
 *  Returns { measured: true, map } or { measured: false, status } on a permission refusal. */
export async function readLocalNewsTopicMap({ fetchImpl, supabaseUrl, apikey }) {
  const map = new Map();
  for (let offset = 0; ; offset += 1000) {
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/alerts?category=eq.local_news&select=source_url,subtopics`
      + `&order=source_url&offset=${offset}&limit=1000`,
      { headers: { apikey, Authorization: `Bearer ${apikey}` } },
    );
    if (res.status === 401 || res.status === 403) return { measured: false, status: res.status };
    if (!res.ok) throw new Error(`Supabase alerts: ${res.status}`);
    const batch = await res.json();
    for (const r of batch) {
      if (!r.source_url) continue;
      const tagged = Array.isArray(r.subtopics) && r.subtopics.length >= 1;
      map.set(r.source_url, (map.get(r.source_url) || false) || tagged);
    }
    if (batch.length < 1000) break;
  }
  return { measured: true, map };
}

/** The verdict for one ZIP. `kind` is 'P' (pass), 'F' (fail) or 'I' (info). */
export function topicGateVerdict({ topic, localNews, enforce }) {
  if (!topic.measured) {
    const detail = `NOT MEASURED: reading alerts.subtopics with the public key was refused`
      + ` (HTTP ${topic.status}); ${localNews.length} Local News row(s) on this page were not checked.`
      + ` The rule is enforced by ${TOPIC_RULE_OWNER}`;
    return { kind: enforce ? 'F' : 'I', detail };
  }
  const untagged = localNews.filter((ch) => topic.map.get(ch.source_ref) !== true);
  if (untagged.length === 0) {
    return { kind: 'P', detail: `all ${localNews.length} Local News row(s) carry >=1 canonical topic` };
  }
  const detail = `${untagged.length} of ${localNews.length} Local News row(s) carry NO canonical topic`
    + ` (e.g. "${String(untagged[0].title).slice(0, 70)}")`;
  return enforce
    ? { kind: 'F', detail }
    : { kind: 'I', detail: `${detail} — gate not yet applied; set LOCAL_NEWS_TOPIC_GATE=1 to enforce` };
}
