export { eligibility } from "./eligibility.js";
export type {
  Attestation,
  Eligibility,
  EligibilityPolicy,
  IneligibleReason,
} from "./eligibility.js";
export { FAKE_PROVIDER, createFakeIdentityProvider } from "./fake.js";
export type { FakeIdentityProvider, FakeOutcome } from "./fake.js";
export {
  CALLBACK_TOLERANCE_SECONDS,
  CallbackRejected,
  readResult,
  signCallback,
  verifyCallbackSignature,
} from "./provider.js";
export type {
  CallbackRejection,
  IdentityProvider,
  VerificationResult,
  VerificationSession,
  VerificationStatus,
} from "./provider.js";
export { NotEligible, createIdentityService } from "./service.js";
export type {
  AttestationStore,
  IdentityService,
  IdentityServiceOptions,
  RecordOutcome,
} from "./service.js";
export { ACCOUNT_LIFECYCLE, ACCOUNT_STATES } from "./account.js";
export type { AccountState } from "./account.js";
export { PAUSE_REASONS, PROFILE_REVIEW_AFTER_DAYS, pauseRefusal, resumeCheck } from "./pause.js";
export type { PauseReason, PauseRefusal, ResumeCheck, ResumeNeed, ResumeState } from "./pause.js";
export {
  DEFAULT_TIER_POLICY,
  LEVELS,
  MINIMUM_AGE,
  ageOn,
  birthDateRefusal,
  requiredLevel,
} from "./tiers.js";
export type {
  BirthDateRefusal,
  DocumentReason,
  Level,
  LivenessVerdict,
  Requirement,
  TierFacts,
  TierPolicy,
} from "./tiers.js";
