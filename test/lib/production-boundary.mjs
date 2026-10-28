// The production-credential boundary: the ONE place its canonical text and its constants live.
//
// Privileged Supabase credentials are issued only through the GitHub environment `production`
// (deployment branches: main only). Every job that holds one carries exactly ENV_LINE before its
// runs-on: line, and its FIRST step is BOUNDARY_STEP. Workflow files cannot import this module, so
// they carry a copy of the step; the tests compare that copy byte for byte against BOUNDARY_STEP
// (comment lines removed, dedented), and any generator that writes the step into a workflow
// imports BOUNDARY_STEP_SOURCE from here instead of retyping it.
//
// Since 2026-10-25 every job that holds a PROD_ secret uses it: the two workflows built for the
// environment (db-read.yml, verify-production-environment.yml, pinned more strictly by
// test/production-boundary-new-workflows.test.mjs) and the 19 existing jobs moved onto it from the
// repository secrets SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN. The full rule test over
// every workflow is test/production-boundary.test.mjs. Both read workflows with the one line scanner
// in ./production-boundary-scan.mjs.
//
// stdlib only. Nothing here is imported by shipped code; it lives under test/ so it never reaches
// the Pages artifact.

/** Issued only through the `production` environment. */
export const PRIVILEGED_ENV = {
  PROD_SUPABASE_DB_URL: 'direct Postgres connection: arbitrary SQL',
  PROD_SUPABASE_SERVICE_ROLE_KEY: 'service role: bypasses RLS, writes tables and storage',
  PROD_SUPABASE_ACCESS_TOKEN: 'account-wide Management API token: SQL, DDL, function deploys',
};

/** The repository-secret names the PROD_ names replace. Never referenced once the switch lands. */
export const RETIRED = ['SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN'];

// RETIRED, BUT NOT YET: the jobs that still read the REPOSITORY secret SUPABASE_DB_URL. Its environment
// copy PROD_SUPABASE_DB_URL is deferred (founder, 2026-10-23: the database password is not on record and a
// reset was declined for now), so these jobs cannot move yet. SHRINK-ONLY: every entry must still reference
// it and no other job may; a job that moves onto PROD_SUPABASE_DB_URL is deleted from here. Generated from
// the workflow files on 2026-10-25 (never typed); test/production-boundary.test.mjs proves the list and the
// files name the same set.
export const DEFERRED_DB_URL_JOBS = [
  'dc-atlas-admission-apply.yml#apply', 'dc-atlas-admission-apply.yml#rollback', 'dc-atlas-admission-dryrun.yml#dryrun',
  'dc-atlas-dryrun.yml#dryrun', 'dc-atlas-phase-a-apply.yml#apply', 'dc-atlas-phase-a-proof.yml#proof',
  'dc-epoch-dryrun.yml#dryrun', 'dc-geocode-observations.yml#derive', 'dc-geocode-probe.yml#probe',
  'dc-geocode-variant-probe.yml#probe', 'dc-openaddresses-match-preview.yml#preview', 'dc-osm-dedupe-apply.yml#gate',
  'dc-osm-dedupe-apply.yml#apply', 'dc-osm-dedupe-apply.yml#rollback', 'dc-osm-layer-apply.yml#apply',
  'dc-osm-layer-apply.yml#rollback', 'dc-osm-map1-apply.yml#gate', 'dc-osm-map1-apply.yml#apply',
  'dc-osm-map1-apply.yml#rollback', 'dc-verdict-apply.yml#gate', 'dc-verdict-apply.yml#apply',
  'dc-verdict-apply.yml#rollback', 'n5-e2e-address-radius.yml#e2e', 'n5-rpc-apply.yml#apply',
];

// A job inside ANOTHER protected environment. A retired name it reads resolves to THAT environment's own
// secret (an environment secret shadows the repository secret of the same name). Exact (job, environment,
// secrets); SHRINK-ONLY like the lists above.
export const OTHER_ENVIRONMENT = {
  'db-migrate-decide.yml#decide': {
    environment: 'prod-db-write',
    secrets: ['SUPABASE_ACCESS_TOKEN', 'MIGRATION_TOTP_SECRET'],
    reason: 'the migration runner (docs/db-migration-runner.md): runs only on a /approve comment with a one-time code; ' +
            'prod-db-write (main only) holds its own SUPABASE_ACCESS_TOKEN and MIGRATION_TOTP_SECRET (setup step 1). ' +
            'Before the repository SUPABASE_ACCESS_TOKEN is deleted, prod-db-write must list its own copy.',
  },
};

/** Environments a job may name besides `production` and OTHER_ENVIRONMENT: they hold no secret any job reads. */
export const SECRETLESS_ENVIRONMENTS = {
  'github-pages': 'the GitHub Pages deployment (pages.yml); no workflow reads a secret from it',
};

// Privileged but still repository secrets (decision 5). SHRINK-ONLY: every (secret, job) pair must
// exist; any other pair fails; moving one into the environment = delete the entry here.
// (DEPLOY_KEY left this list on 2026-10-25: sitemap.yml was deleted and source-monitor.yml stopped
// pushing on 2026-10-24, and no workflow names it; test/no-deploy-key-push.test.mjs keeps it out.)
export const PRIVILEGED_PENDING = {
  INGEST_DISPATCH_TOKEN: { jobs: ['n5-generation.yml#orchestrate'],
    reason: 'fine-grained PAT, Actions: write on homesignal-ingest: dispatches any ingest workflow on main with chosen inputs' },
  EPA_RECOVERY_TOKEN: { jobs: ['epa-recovery-watch.yml#recover'],
    reason: 'unlocks epa_recovery_* RPCs; DB keeps only its sha256; harm bounded by the RPCs\' own gates' },
  BING_WEBMASTER_API_KEY: { jobs: ['bing-daily-submit.yml#submit'],
    reason: 'Bing Webmaster Tools API key (added 2026-10-27): account-wide for that Bing account, not limited to the URL ' +
            'submission this job does; a dispatch from a branch can read it. A candidate for an environment of its own' },
  NETLIFY_AUTH_TOKEN: { jobs: ['jody-redirect-verify.yml#verify'],
    reason: 'account-wide Netlify token; possibly unset (MIGRATION-STATUS: "secret missing, inferred"); Netlify replaced by Render: delete' },
};

export const NON_PRIVILEGED = {
  GITHUB_TOKEN: 'per-run token; its dispatches are refused by the boundary step (R6)',
  SUPABASE_URL: 'public project URL (config.js:6)',
  SUPABASE_ANON_KEY: 'public anon key (config.js:7)',
  INDEXNOW_KEY: 'public by design, served at /indexnow.txt',
  MAPS_HOME_LAT: 'a coordinate, not a credential (private; see risks)',
  MAPS_HOME_LNG: 'a coordinate, not a credential (private; see risks)',
};

/** vars.NAME references allowed in workflows. None today. */
export const ALLOWED_VARS = {};

/** The environment line, at job indent, immediately before the job's runs-on: line. */
export const ENV_LINE = 'environment: { name: production, deployment: false }';

// The canonical refusal step, dedented, comments included. Comment lines are not part of the
// contract (BOUNDARY_STEP below drops them), so their wording may change; every other byte is fixed.
export const BOUNDARY_STEP_SOURCE = [
  "- name: 'Production boundary: refuse a dispatch the operator did not start'",
  '  id: boundary',
  '  # FIRST step, before any step that holds a secret. The production environment admits only',
  "  # ref main, but a workflow_dispatch's INPUTS are chosen by whoever dispatched it; another",
  "  # run's GITHUB_TOKEN (github-actions[bot]) or an installed app (<app>[bot]) would let branch",
  '  # code choose them. github.actor is the original dispatcher and github.triggering_actor the',
  '  # re-runner (a re-run replays the original inputs), so both must be the operator.',
  '  # Canonical text: test/lib/production-boundary.mjs (BOUNDARY_STEP); the tests compare this',
  '  # step to it byte for byte, comment lines excluded.',
  "  if: github.event_name == 'workflow_dispatch' && (github.actor != 'HomeSignalG' || github.triggering_actor != 'HomeSignalG')",
  '  env:',
  '    ACTOR: ${{ github.actor }}',
  '    TRIGGERING_ACTOR: ${{ github.triggering_actor }}',
  '  run: |',
  '    echo "::error::Production credentials are not issued to this dispatch (actor=$ACTOR, triggering_actor=$TRIGGERING_ACTOR). Only HomeSignalG may start or re-run a production dispatch, from main."',
  '    exit 1',
].join('\n');

/** A YAML comment line: optional indentation, then '#'. */
export const isCommentLine = (l) => /^\s*#/.test(l);

/** Remove comment lines and trailing blank lines (the form a step is compared in). */
export function stripCommentLines(text) {
  const lines = text.split('\n').filter((l) => !isCommentLine(l));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

/** The canonical step in the form it is compared in: comment lines removed, dedented. */
export const BOUNDARY_STEP = stripCommentLines(BOUNDARY_STEP_SOURCE);

/** BOUNDARY_STEP_SOURCE indented for a workflow's steps: list (6 spaces in this repo). */
export function boundaryStepYaml(indent = 6) {
  const pad = ' '.repeat(indent);
  return BOUNDARY_STEP_SOURCE.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

// The only ${{ }} bodies allowed inside a production job's run: text (design R15). Inputs and
// other caller-chosen values reach the shell through env, never by expansion into the script.
// github.workspace and runner.temp (added 2026-10-25) are paths the runner sets; no dispatcher chooses them.
export const RUN_EXPRESSION_ALLOWED = [
  /^github\.(event_name|sha|event\.before|repository|ref_name|run_id|run_attempt|token|workspace)$/,
  /^runner\.temp$/,
  /^steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_-]+$/,
];
export const runExpressionAllowed = (body) => RUN_EXPRESSION_ALLOWED.some((re) => re.test(body.trim()));
