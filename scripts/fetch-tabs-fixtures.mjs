// fetch-tabs-fixtures.mjs — Step 0 of docs/tdlr-tabs-adapter-runbook.md.
// Fetches each pinned TDLR TABS project page and saves the raw HTML under
// fixtures/tabs/<project_no>.html. Runs in CI (the build sandbox has no egress).
//
// Politeness (runbook §0.4): sequential, >=1.2s apart (we use 1.5s), identified UA.
// Quarantine-don't-stop (§7.2): a non-200 or self-number mismatch is logged to
// fixtures/tabs/quarantine.json and skipped; the run still succeeds. A 404'd number
// is REMOVED from the pins file by a human, never guessed at.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const UA = "HomeSignal refresh";
const GAP_MS = 1500;
const pins = JSON.parse(readFileSync("docs/pins/tdlr-tabs-projects.travis.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync("fixtures/tabs", { recursive: true });
const quarantine = [];
let saved = 0;

for (const no of pins.project_nos) {
  const url = pins.record_url_template.replace("{project_no}", no);
  let status = 0, body = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    status = r.status;
    body = await r.text();
  } catch (e) {
    quarantine.push({ project_no: no, url, error: String(e.message || e) });
    console.log(`  ✗ ${no} — fetch error: ${e.message}`);
    await sleep(GAP_MS);
    continue;
  }
  if (status !== 200) {
    quarantine.push({ project_no: no, url, status });
    console.log(`  ✗ ${no} — HTTP ${status} (quarantined, not guessed)`);
  } else if (!body.includes(no)) {
    quarantine.push({ project_no: no, url, status, error: "page does not state its own project number" });
    console.log(`  ✗ ${no} — 200 but page does not state its own number (quarantined)`);
  } else {
    writeFileSync(`fixtures/tabs/${no}.html`, body);
    saved++;
    console.log(`  ✓ ${no} — ${body.length} bytes, states its own number`);
  }
  await sleep(GAP_MS);
}

writeFileSync("fixtures/tabs/quarantine.json", JSON.stringify({ fetched_at: new Date().toISOString(), ua: UA, quarantined: quarantine }, null, 2) + "\n");
console.log(`\n${saved}/${pins.project_nos.length} fixtures saved; ${quarantine.length} quarantined.`);
if (saved === 0) { console.error("No fixture could be fetched — nothing to commit."); process.exit(1); }
