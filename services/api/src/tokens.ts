// Injection tokens. Every injected dependency names its token with
// `@Inject(TOKEN)`: nothing relies on emitDecoratorMetadata (ADR-0005).
export const READINESS = Symbol("Readiness");
export const METRICS = Symbol("Metrics");
export const LIFECYCLE = Symbol("Lifecycle");
export const LOGGER = Symbol("Logger");
export const INVITATIONS = Symbol("Invitations");
export const CALLERS = Symbol("Callers");
export const CLOCK = Symbol("Clock");
export const AUTH = Symbol("Auth");
export const ACCOUNT = Symbol("Account");
export const FEEDBACK = Symbol("Feedback");
export const RELATIONSHIPS = Symbol("Relationships");
export const REVEAL = Symbol("Reveal");
export const SAFETY = Symbol("Safety");
