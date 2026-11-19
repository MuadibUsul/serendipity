/**
 * A lifecycle: a status that only moves along declared edges. For the simple
 * statuses of a row (an invitation, a profile version, a photo) where the
 * full event machine of `date/` would be too much, but where the allowed
 * moves still need to live in one place instead of in scattered `WHERE
 * status = …` clauses.
 *
 * The edges are data, so the same table drives the code (`can`, `assertCan`),
 * the database guard that refuses any other move (migration 0009), the test
 * that the two agree, and the generated map in docs/state-machines.md.
 */
export interface Lifecycle<S extends string> {
  /** Where it is stored, e.g. `app.date_invites.status`. */
  readonly name: string;
  readonly states: readonly S[];
  /** The state a row starts in. */
  readonly initial: S;
  /** Every allowed move, from each state. A state with none is terminal. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  /** Whether a row may move from `from` to `to`. Staying put is not a move. */
  can(from: S, to: S): boolean;
  /** Throws `IllegalTransition` unless `can(from, to)`. */
  assertCan(from: S, to: S): void;
  isTerminal(state: S): boolean;
  /** Every allowed move as `[from, to]`, in declaration order. */
  edges(): readonly (readonly [S, S])[];
}

export class IllegalTransition extends Error {
  constructor(
    readonly lifecycle: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${lifecycle}: ${from} → ${to} is not an allowed move`);
    this.name = "IllegalTransition";
  }
}

/**
 * Declares a lifecycle. `transitions` must name every state (the type makes
 * a missing one a compile error); the spec is also checked at load time, so
 * a typo or an unreachable state fails at once instead of at the first write.
 */
export function defineLifecycle<const S extends string>(spec: {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: NoInfer<S>;
  readonly transitions: Readonly<Record<NoInfer<S>, readonly NoInfer<S>[]>>;
}): Lifecycle<S> {
  const known = new Set<string>(spec.states);
  if (known.size !== spec.states.length) throw new Error(`${spec.name}: a state is listed twice`);
  if (!known.has(spec.initial)) throw new Error(`${spec.name}: unknown initial state`);
  for (const [from, targets] of Object.entries(spec.transitions) as [S, readonly S[]][]) {
    if (!known.has(from)) throw new Error(`${spec.name}: unknown state ${from}`);
    for (const to of targets) {
      if (!known.has(to)) throw new Error(`${spec.name}: ${from} → unknown state ${to}`);
      if (to === from) throw new Error(`${spec.name}: ${from} → ${from} is not a move`);
    }
  }
  for (const state of spec.states) {
    if (!Object.hasOwn(spec.transitions, state)) {
      throw new Error(`${spec.name}: no transitions listed for ${state}`);
    }
  }
  // Every state must be reachable from the initial one, or it is dead weight.
  const reached = new Set<S>([spec.initial]);
  const queue: S[] = [spec.initial];
  for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
    for (const next of spec.transitions[state]) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = spec.states.filter((state) => !reached.has(state));
  if (unreachable.length > 0) {
    throw new Error(`${spec.name}: unreachable from ${spec.initial}: ${unreachable.join(", ")}`);
  }

  const lifecycle: Lifecycle<S> = {
    name: spec.name,
    states: spec.states,
    initial: spec.initial,
    transitions: spec.transitions,
    can: (from, to) => spec.transitions[from].includes(to),
    assertCan(from, to) {
      if (!lifecycle.can(from, to)) throw new IllegalTransition(spec.name, from, to);
    },
    isTerminal: (state) => spec.transitions[state].length === 0,
    edges: () =>
      spec.states.flatMap((from) => spec.transitions[from].map((to) => [from, to] as const)),
  };
  return lifecycle;
}
