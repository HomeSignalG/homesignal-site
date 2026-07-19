// AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/transition-spec.v1.json
// Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

export const SCHEMA_VERSION = 1;
export const TRANSITION_SPEC_VERSION = "1.0";

/** @type {readonly string[]} */
export const STATES = [
  "discovered",
  "discriminated",
  "validated",
  "title_gate_verified",
  "inserted",
  "verified",
  "dry_running",
  "dry_run_pass",
  "dry_run_failed",
  "goliving",
  "title_verified",
  "title_verify_failed",
  "activating",
  "active",
  "activation_failed",
  "open_circuit",
  "circuit_halting",
  "circuit_halted",
  "rollback_running",
  "rollback_failed",
  "rolled_back",
  "superseded",
  "abandoned"
];

/** @type {readonly string[]} */
export const TERMINAL_STATES = [
  "superseded",
  "abandoned"
];

/**
 * @typedef {{ from: string, to: string, event: string, requires_gate?: string }} Transition
 */

/** @type {readonly Transition[]} */
export const TRANSITIONS = [
  {
    "from": "discovered",
    "to": "discriminated",
    "event": "discriminate",
    "requires_gate": "scope_discriminator"
  },
  {
    "from": "discriminated",
    "to": "validated",
    "event": "validate",
    "requires_gate": "validation_prerequisites"
  },
  {
    "from": "validated",
    "to": "title_gate_verified",
    "event": "title_gate_pass",
    "requires_gate": "scope_discriminator"
  },
  {
    "from": "title_gate_verified",
    "to": "inserted",
    "event": "insert",
    "requires_gate": "insert_success"
  },
  {
    "from": "inserted",
    "to": "dry_running",
    "event": "start_dry_run"
  },
  {
    "from": "verified",
    "to": "dry_running",
    "event": "start_dry_run"
  },
  {
    "from": "dry_running",
    "to": "dry_run_pass",
    "event": "dry_run_pass"
  },
  {
    "from": "dry_running",
    "to": "dry_run_failed",
    "event": "dry_run_fail"
  },
  {
    "from": "dry_run_pass",
    "to": "goliving",
    "event": "start_golive"
  },
  {
    "from": "goliving",
    "to": "title_verified",
    "event": "title_verify_pass",
    "requires_gate": "title_verified_at"
  },
  {
    "from": "goliving",
    "to": "title_verify_failed",
    "event": "title_verify_fail"
  },
  {
    "from": "title_verified",
    "to": "activating",
    "event": "start_activation",
    "requires_gate": "activation_gates"
  },
  {
    "from": "activating",
    "to": "active",
    "event": "activate",
    "requires_gate": "activation_gates"
  },
  {
    "from": "activating",
    "to": "activation_failed",
    "event": "activation_fail"
  },
  {
    "from": "active",
    "to": "open_circuit",
    "event": "open_circuit"
  },
  {
    "from": "active",
    "to": "superseded",
    "event": "supersede"
  },
  {
    "from": "active",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "open_circuit",
    "to": "circuit_halting",
    "event": "start_circuit_halt"
  },
  {
    "from": "circuit_halting",
    "to": "circuit_halted",
    "event": "circuit_halted"
  },
  {
    "from": "circuit_halted",
    "to": "rollback_running",
    "event": "start_rollback"
  },
  {
    "from": "rollback_running",
    "to": "rolled_back",
    "event": "rollback_complete"
  },
  {
    "from": "rollback_running",
    "to": "rollback_failed",
    "event": "rollback_fail"
  },
  {
    "from": "rolled_back",
    "to": "superseded",
    "event": "supersede"
  },
  {
    "from": "discovered",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "discriminated",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "validated",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "title_gate_verified",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "inserted",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "verified",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "dry_running",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "dry_run_failed",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "title_verify_failed",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "activation_failed",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "rollback_failed",
    "to": "abandoned",
    "event": "abandon"
  },
  {
    "from": "title_gate_verified",
    "to": "verified",
    "event": "legacy_verify"
  },
  {
    "from": "inserted",
    "to": "verified",
    "event": "legacy_verify"
  },
  {
    "from": "dry_run_pass",
    "to": "verified",
    "event": "legacy_verify"
  },
  {
    "from": "title_verified",
    "to": "verified",
    "event": "legacy_verify"
  },
  {
    "from": "verified",
    "to": "goliving",
    "event": "start_golive"
  },
  {
    "from": "verified",
    "to": "activating",
    "event": "start_activation",
    "requires_gate": "activation_gates"
  },
  {
    "from": "verified",
    "to": "active",
    "event": "activate",
    "requires_gate": "activation_gates"
  }
];

/** @type {Record<string, { description: string }>} */
export const GATES = {
  "scope_discriminator": {
    "description": "Vendor scope discriminator present (view_id, legistar client, civicclerk sub, etc.)"
  },
  "validation_prerequisites": {
    "description": "Candidate row has required fields for validation"
  },
  "insert_success": {
    "description": "Feed row inserted into public.feeds without error"
  },
  "title_verified_at": {
    "description": "title_verified_at timestamp set after L2 title check"
  },
  "activation_gates": {
    "description": "All activation gates pass (sync, circuit, active=false, title_verified_at, etc.)"
  }
};

/** @type {Map<string, Transition[]>} */
export const TRANSITIONS_BY_FROM = new Map(
  STATES.map((state) => [
    state,
    TRANSITIONS.filter((t) => t.from === state),
  ]),
);

/** @param {string} state */
export function isTerminalState(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} event
 */
export function findTransition(from, to, event) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && t.event === event) ?? null;
}

/**
 * @param {string} from
 * @param {string} event
 */
export function legalTargets(from, event) {
  return TRANSITIONS.filter((t) => t.from === from && t.event === event).map((t) => t.to);
}
