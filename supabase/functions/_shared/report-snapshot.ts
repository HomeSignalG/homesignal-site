// Durable report snapshots — the engine-agnostic half (Development Activity plan, Order F).
//
// A report engine assembles content. This module turns that content into a STORED snapshot with
// two different identifiers, and nothing else:
//   content_hash  SHA-256 (hex) of `body`, the exact bytes of the content. Deterministic, so two
//                 snapshots of unchanged data share it. It is an integrity / dedup fingerprint.
//   report_id     a UUID minted by the DATABASE (public.report_snapshot_issue) when the snapshot
//                 is stored. One per issuance. It is not derived from anything, and this module
//                 cannot choose it.
//
// The SQL of record is docs/report-snapshot.sql. The database enforces content_hash = sha256(body),
// so a hash this module got wrong would be refused rather than stored.
//
// This file names no engine, no city and no source, imports no client library, and reads no
// environment. The caller hands in `rpc`, so the module cannot reach the database by any other path.

/** Fields that describe a report but are not part of its content, so they are never hashed. */
export const CONTENT_HASH_EXCLUDED = ['report_id', 'generated_at', 'content_hash'] as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The exact text that is stored and hashed: the report with the identity fields removed, serialised
 * with JSON.stringify in insertion order. For an engine that used to hash "everything but report_id
 * and generated_at" this is the same string, so the hash is unchanged (test/report-snapshot.test.mjs
 * pins that against the NYC V1 engine, which is left untouched).
 */
export function snapshotBodyOf(report: Record<string, unknown>): string {
  const copy = JSON.parse(JSON.stringify(report));
  for (const k of CONTENT_HASH_EXCLUDED) delete copy[k];
  return JSON.stringify(copy);
}

export async function contentHashOf(report: Record<string, unknown>): Promise<string> {
  return sha256Hex(snapshotBodyOf(report));
}

export type SnapshotRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type SnapshotEnvelope = {
  report_id: string;
  content_hash: string;
  report_version: string;
  generated_at: string;
  report: Record<string, unknown>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Store one report and return its envelope. Fails closed: if the database did not confirm a stored
 * row with a well-formed id, nothing is returned, so a caller can never hand out a report_id that
 * does not exist. Issuing the same report twice stores two snapshots with two ids (retry
 * idempotency belongs with the credit ledger, not here).
 */
export async function issueSnapshot(
  rpc: SnapshotRpc,
  report: Record<string, unknown>,
  opts: { reportVersion: string; inputs: Record<string, unknown>; propertyKey?: string | null },
): Promise<SnapshotEnvelope> {
  if (!isObject(report)) throw new Error('issueSnapshot: the report must be an object');
  if (typeof opts.reportVersion !== 'string' || !opts.reportVersion.trim()) {
    throw new Error('issueSnapshot: reportVersion is required');
  }
  if (!isObject(opts.inputs)) throw new Error('issueSnapshot: inputs must be an object');

  const body = snapshotBodyOf(report);
  const contentHash = await sha256Hex(body);
  const { data, error } = await rpc('report_snapshot_issue', {
    p_body: body,
    p_content_hash: contentHash,
    p_report_version: opts.reportVersion,
    p_inputs: opts.inputs,
    p_property_key: opts.propertyKey ?? null,
  });
  if (error) throw new Error('issueSnapshot: the snapshot was not stored: ' + error.message);

  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!isObject(row)) throw new Error('issueSnapshot: the database did not return exactly one stored snapshot');
  const reportId = row.report_id;
  const generatedAt = row.generated_at;
  if (typeof reportId !== 'string' || !UUID_V4.test(reportId)) {
    throw new Error('issueSnapshot: the database returned no well-formed report_id');
  }
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('issueSnapshot: the database returned no generated_at');
  }
  return {
    report_id: reportId,
    content_hash: contentHash,
    report_version: opts.reportVersion,
    generated_at: generatedAt,
    // parsed from the stored text, so what is returned is what is stored
    report: JSON.parse(body),
  };
}

/**
 * Anyone holding an envelope can check that its content matches its content_hash: hash the report
 * as delivered. This proves the content is internally consistent, not who issued it (it is an
 * unkeyed hash, not a signature) and not that it is the stored copy (only report_id, looked up
 * server-side, says that).
 */
export async function envelopeMatchesItsHash(envelope: SnapshotEnvelope): Promise<boolean> {
  if (!envelope || !isObject(envelope.report) || typeof envelope.content_hash !== 'string') return false;
  return (await sha256Hex(JSON.stringify(envelope.report))) === envelope.content_hash;
}
