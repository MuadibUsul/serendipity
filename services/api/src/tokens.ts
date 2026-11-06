// Injection tokens. Every injected dependency names its token with
// `@Inject(TOKEN)`: nothing relies on emitDecoratorMetadata (ADR-0005).
export const READINESS = Symbol("Readiness");
export const METRICS = Symbol("Metrics");
export const LIFECYCLE = Symbol("Lifecycle");
export const LOGGER = Symbol("Logger");
