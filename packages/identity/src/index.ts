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
