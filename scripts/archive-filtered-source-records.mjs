#!/usr/bin/env node
// Keep the source records a registry noise filter drops, in public.filtered_source_records_archive.
//
//   node --experimental-strip-types scripts/archive-filtered-source-records.mjs \
//        --registry tacoma-accela-permits --since 2025-10-15 [--apply]
//
// Report-only by default. The DECISION is the shipped one: the registry entry (service_url, extra_where,
// column_map, drop_minor_repairs.types) and sources/record-hygiene.ts::isMinorRepairNoise, applied to the same
// title the connector builds (readCol joins an array column_map with one space). Nothing here re-states the rule.
//
// --since bounds the publisher's file date (column_map.file_date). 2025-10-15 is 365 days before the filter
// shipped (2026-10-15) with recency_days 365, so it covers every record the filter could have taken off a page.
// Records are archived whatever their status, and the status is stored beside them.
//
// --apply inserts with ON CONFLICT DO NOTHING (the table is append-only), then reads the archive back and
// compares the id fingerprint of this run's set against what is stored. Both sides are sorted in JavaScript
// (codepoint order), so no database collation is involved. A missing id fails the run.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(here, "..", "supabase", "functions", "get-address-report");

export function parseArgs(argv) {
  const out = { registry: "tacoma-accela-permits", since: "2025-10-15", apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--registry") out.registry = argv[++i];
    else if (a === "--since") out.since = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.since)) throw new Error(`--since must be YYYY-MM-DD, got ${out.since}`);
  return out;
}

export function readCol(row, ref) {
  if (!ref) return undefined;
  if (Array.isArray(ref)) {
    const parts = ref.map((c) => row[c]).filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim());
    return parts.length ? parts.join(" ") : undefined;
  }
  return row[ref];
}

function isoDay(v) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function extractUrl(v) {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object" && typeof v.url === "string") return v.url.trim() || null;
  return null;
}

export const fingerprint = (ids) =>
  `${ids.length}:${createHash("md5").update([...ids].sort().join(",")).digest("hex")}`;

/** Pick the rows the shipped filter drops, and shape them as archive rows. Pure. */
export function selectDropped(rows, entry, hygiene, filterName = "drop_minor_repairs") {
  const cm = entry.column_map;
  const types = entry.drop_minor_repairs?.types;
  if (!Array.isArray(types) || !types.length) throw new Error(`${entry.registry_id} declares no drop_minor_repairs.types`);
  const rule = createHash("md5")
    .update(hygiene.MINOR_REPAIR_PATTERN + "|" + hygiene.DEVELOPMENT_OVERRIDE_PATTERN).digest("hex");
  const out = [];
  const seen = new Set();
  let noId = 0;
  for (const row of rows) {
    const type = String(readCol(row, cm.type_source) ?? "").trim();
    if (!types.includes(type)) continue;
    const title = String(readCol(row, cm.title) ?? "");
    if (!hygiene.isMinorRepairNoise(title)) continue;
    const id = String(readCol(row, cm.case_number) ?? "").trim();
    if (!id) { noId++; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      registry_id: entry.registry_id,
      source_record_id: id,
      filter_name: filterName,
      rule_fingerprint: rule,
      title: title.replace(/\s+/g, " ").trim() || null,
      record_type: type || null,
      status_raw: valueOrNull(readCol(row, cm.status_raw)),
      file_date: isoDay(readCol(row, cm.file_date)),
      record_url: extractUrl(readCol(row, cm.record_url)),
      row_json: row,
      reason: `matches ${filterName} (types ${types.join(", ")}); kept because the filter removes it from HomeSignal pages`,
    });
  }
  return { rows: out, noId, rule };
}

function valueOrNull(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

async function getJson(url, init) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, init);
    const text = await r.text();
    if (r.ok) {
      const j = JSON.parse(text);
      if (j && j.error) throw new Error(`${url.split("?")[0]} -> ${JSON.stringify(j.error).slice(0, 300)}`);
      return j;
    }
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${url.split("?")[0]} -> HTTP ${r.status} ${text.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}

async function fetchSourceRows(entry, since) {
  const meta = await getJson(`${entry.service_url}?f=json`);
  const oid = meta.objectIdField || (meta.fields || []).find((f) => f.type === "esriFieldTypeOID")?.name;
  if (!oid) throw new Error("layer declares no objectIdField");
  const page = Math.min(Number(meta.maxRecordCount) || 1000, 2000);
  const where = `(${entry.extra_where || "1=1"}) AND ${entry.column_map.file_date} >= DATE '${since}'`;
  const countJ = await getJson(`${entry.service_url}/query?${new URLSearchParams({ where, returnCountOnly: "true", f: "json" })}`);
  const expected = Number(countJ.count);
  const rows = [];
  for (let offset = 0; ; offset += page) {
    const q = new URLSearchParams({
      where, outFields: "*", returnGeometry: "false", orderByFields: `${oid} ASC`,
      resultOffset: String(offset), resultRecordCount: String(page), f: "json",
    });
    const j = await getJson(`${entry.service_url}/query?${q}`);
    const feats = j.features || [];
    for (const f of feats) rows.push(f.attributes || {});
    if (feats.length < page && !j.exceededTransferLimit) break;
    if (!feats.length) break;
  }
  if (rows.length !== expected) throw new Error(`source returned ${rows.length} rows, its own count says ${expected}`);
  return { rows, where, expected };
}

async function rest(pathAndQuery, init = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply");
  const r = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`REST ${pathAndQuery.split("?")[0]} -> HTTP ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function storedIds(registryId) {
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const q = `filtered_source_records_archive?select=source_record_id&registry_id=eq.${encodeURIComponent(registryId)}&order=source_record_id&limit=1000&offset=${offset}`;
    const page = await rest(q);
    for (const r of page) ids.push(r.source_record_id);
    if (page.length < 1000) break;
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(readFileSync(path.join(FN, "jurisdiction-registry.json"), "utf8"));
  const entry = (registry.arcgis || []).find((e) => e.registry_id === args.registry);
  if (!entry) throw new Error(`arcgis registry entry ${args.registry} not found`);
  const hygiene = await import(path.join(FN, "sources", "record-hygiene.ts"));

  const { rows, where, expected } = await fetchSourceRows(entry, args.since);
  const picked = selectDropped(rows, entry, hygiene);
  const ids = picked.rows.map((r) => r.source_record_id);
  console.log(`source: ${entry.service_url}`);
  console.log(`where: ${where}`);
  console.log(`source rows read: ${rows.length} (source count ${expected})`);
  console.log(`dropped by the filter: ${picked.rows.length} distinct records (no id: ${picked.noId})`);
  console.log(`rule fingerprint: ${picked.rule}`);
  console.log(`id fingerprint: ${fingerprint(ids)}`);
  const byStatus = new Map();
  for (const r of picked.rows) byStatus.set(r.status_raw, (byStatus.get(r.status_raw) || 0) + 1);
  console.log(`by status: ${[...byStatus].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")}`);
  for (const r of picked.rows.slice(0, 8)) console.log(`  sample: ${r.source_record_id} | ${r.title}`);
  if (!rows.length) throw new Error("source returned 0 rows: nothing was verified");

  if (!args.apply) { console.log("report only (pass --apply to write)"); return; }

  const before = new Set(await storedIds(entry.registry_id));
  for (let i = 0; i < picked.rows.length; i += 500) {
    await rest("filtered_source_records_archive?on_conflict=registry_id,source_record_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(picked.rows.slice(i, i + 500)),
    });
  }
  const after = await storedIds(entry.registry_id);
  const afterSet = new Set(after);
  const missing = ids.filter((id) => !afterSet.has(id));
  const added = ids.filter((id) => !before.has(id)).length;
  console.log(`archive before: ${before.size} · added this run: ${added} · stored now: ${after.length}`);
  const storedOfRun = ids.filter((id) => afterSet.has(id));
  console.log(`this run's set stored: ${fingerprint(storedOfRun)} (expected ${fingerprint(ids)})`);
  if (missing.length) throw new Error(`${missing.length} records not stored, e.g. ${missing.slice(0, 5).join(", ")}`);
  console.log("OK: every record this run selected is in the archive");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
}
