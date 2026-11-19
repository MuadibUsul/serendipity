export {
  CHALLENGE_LIFECYCLE,
  CHALLENGE_STATES,
  SESSION_LIFECYCLE,
  SESSION_STATES,
} from "./lifecycle.js";
export type { ChallengeState, SessionState } from "./lifecycle.js";
export { normalizePhone } from "./phone.js";
export { AUTH_POLICY } from "./policy.js";
export { MIN_SECRET_BYTES, createHasher, randomCode, randomToken, sameHash } from "./secrets.js";
export type { Hasher } from "./secrets.js";
export { createAuthService } from "./service.js";
export type {
  AuthRepository,
  AuthService,
  CodeLimits,
  CodeRequest,
  IssuedTokens,
  Refresh,
  RefreshRefusal,
  SignIn,
  SmsProvider,
  StoredTokens,
  VerifyRefusal,
} from "./service.js";
export { DEV_CODE, FAKE_SMS, createFakeSms } from "./sms.js";
export type { FakeSms } from "./sms.js";
