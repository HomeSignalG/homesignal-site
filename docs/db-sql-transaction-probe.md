# db-sql transaction probe (NOT dispatched; review first)

**Purpose.** The v2 city-community SQL uses `SET LOCAL` and an `ON COMMIT DROP` temporary table and has no `BEGIN`/`COMMIT`. A local `psql -c` rehearsal does not prove that the production route (`db-sql.yml` -> Supabase Management API) behaves the same. This probe tests exactly that, and nothing else.

**What it changes.** No persistent application-data changes: one transaction-local setting (`homesignal.tx_probe`) and one temporary table (`hs_tx_probe_20261121`) that is dropped at commit (or at session end on failure). No permanent objects, application tables, roles, extensions or persistent configuration. It is not "no writes": the workflow run and the Management API normally leave an Actions run record and the API's own query/audit log entry, and the temp table is created and dropped inside the database.

## Execution controls (existing `db-sql.yml`, unmodified)
- **Dispatch:** workflow `db-sql`, `workflow_dispatch`, ref **main**, one input: `sql_file = docs/db-sql-transaction-probe.sql`. The probe file must be on `main` first (the `production` environment refuses branch dispatches). Only `HomeSignalG` may dispatch. Nothing in the workflow or its protections is changed by this PR.
- **How the file is submitted:** the job reads the whole file (`sql = open(path).read()`) and sends it as ONE JSON body `{"query": sql}` to `POST https://api.supabase.com/v1/projects/<ref>/database/query`. Statements are not split by the runner.
- **Result channel:** the job prints `HTTP <status>` and the response body between `----- BEGIN RESULT -----` and `----- END RESULT -----`.

## Expected success receipt
`HTTP 201` and a result row whose `receipt` is `TX_PROBE_OK`, with `same_transaction = true`, `same_session = true`, `setting_seen_by_stmt3` and `setting_seen_by_stmt4` both `hs-tx-probe-20261121`, and `temp_rows = 1`.

## Interpreting outcomes
- **Workflow success is not SQL success.** A green job only means the API answered 2xx. Read the receipt in the log.
- **Proven:** `TX_PROBE_OK` as above. The route ran the submitted string in one transaction and one session, so `SET LOCAL` and an `ON COMMIT DROP` table persist across its statements.
- **Failed (route does NOT supply the semantics):** the job fails with HTTP 4xx and a `relation "hs_tx_probe_20261121" does not exist` error (the table was dropped after its own statement), or the receipt is `TX_PROBE_MISMATCH` / shows a null setting or `same_transaction = false`.
- **Inconclusive:** any other HTTP status, a timeout, a missing or truncated result block, an empty result, or a result without a `receipt` column (for example if the API returns something other than the last statement's rows). Do not treat these as success and do not rerun automatically; report them.
- A success proves behavior only for the string-submission shape tested here, at the time of the run.

## Cleanup
None needed after success (the temp table dropped at commit, the setting reverted with the transaction). After failure the session-level temp table is dropped when the session ends. Nothing persistent to remove. The only remaining record is the Actions run and API log.

## Local verification
Not performed against PostgreSQL 17.6: the earlier local server was removed after the rehearsal and, per the approval, was not reinstalled for this. Only the `psql` client is present. The SQL has therefore NOT been executed anywhere; reviewers should read it as unexecuted.

## Related, out of scope here
A reviewed and rehearsed ZIP-expansion rollback/recovery procedure is a release prerequisite before the expansion is applied in production. This PR does not write or run it, and authorizes no refresh, report generation, enrollment, feed activation or SQL application.
