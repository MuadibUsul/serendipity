export {
  ATMOSPHERES,
  CERTAINTIES,
  DIETARY_RESTRICTIONS,
  FACT_CONSENT_SCOPES,
  FACTS,
  FACT_KEYS,
  PRICE_BANDS,
  PROFILE_SCHEMA_VERSION,
  PROVENANCES,
  RELATIONSHIP_GOALS,
  SUBJECTS,
  TASTES,
  VISIBILITIES,
  WEEKDAYS,
  consentFor,
  isFactKey,
  specOf,
} from "./catalog.js";
export type {
  Certainty,
  DietaryRestriction,
  FactConsentScope,
  FactKey,
  FactSpec,
  Provenance,
  Subject,
  ValueSpec,
  Visibility,
  Weekday,
} from "./catalog.js";
export {
  NO_FACTS,
  OUTDATED_AFTER_DAYS,
  applyProposals,
  confirmFact,
  hardRules,
  markOutdated,
  missingRequired,
  removeFact,
  setVisibility,
  snapshotOf,
  unconsentedKeys,
  withConsent,
} from "./rules.js";
export type {
  Conflict,
  EditResult,
  Fact,
  Facts,
  GrantedScopes,
  HardRule,
  ProfileSnapshot,
  Proposal,
  ProposalOutcome,
  Refusal,
  RefusalReason,
} from "./rules.js";
export { sameValue, validateValue, valueKey } from "./values.js";
export type { FactValue, ValueResult } from "./values.js";
export { VERSION_LIFECYCLE, VERSION_STATES } from "./lifecycle.js";
export type { VersionState } from "./lifecycle.js";
