// Phase 1B P0 — feed candidate state machine (JS mirror of generated spec).
import {
  findTransition,
  isTerminalState,
  legalTargets,
  TERMINAL_STATES,
  TRANSITIONS,
  TRANSITIONS_BY_FROM,
} from '../../../lib/generated/transitions.mjs';

export {
  findTransition,
  isTerminalState,
  legalTargets,
  TERMINAL_STATES,
  TRANSITIONS,
  TRANSITIONS_BY_FROM,
};

/**
 * @param {string} from
 * @param {string} to
 * @param {string} event
 */
export function isLegalTransition(from, to, event) {
  return findTransition(from, to, event) !== null;
}

/**
 * List all legal (to, event) pairs from a state.
 * @param {string} from
 */
export function outgoingTransitions(from) {
  return TRANSITIONS_BY_FROM.get(from) ?? [];
}

/**
 * Validate a proposed transition; returns null if legal, else an error string.
 * @param {{ from: string, to: string, event: string, gates?: Record<string, boolean> }} args
 */
export function validateTransition({ from, to, event, gates = {} }) {
  const t = findTransition(from, to, event);
  if (!t) {
    return `illegal transition: ${from} --[${event}]--> ${to}`;
  }
  if (isTerminalState(from)) {
    return `cannot leave terminal state: ${from}`;
  }
  if (t.requires_gate && gates[t.requires_gate] !== true) {
    return `gate not satisfied: ${t.requires_gate}`;
  }
  return null;
}

/**
 * @param {string} state
 * @param {string} event
 */
export function resolveTransition(state, event, gates = {}) {
  const candidates = legalTargets(state, event);
  for (const to of candidates) {
    const err = validateTransition({ from: state, to, event, gates });
    if (!err) return { to, transition: findTransition(state, to, event) };
  }
  return { to: null, transition: null, error: `no legal target for ${state} + ${event}` };
}
