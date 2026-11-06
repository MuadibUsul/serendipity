export {
  CONSENT_POLICY_VERSION,
  FLOWS,
  OTHER_PERSON_RECIPIENTS,
  PURPOSES,
  RECIPIENT_CLASSES,
  RESOURCES,
  SCOPES,
} from "./catalog.js";
export type { Flow, Purpose, RecipientClass, Resource, Scope, ScopeId } from "./catalog.js";
export { decide, denial } from "./decide.js";
export type {
  AccessRequest,
  AllowReason,
  AuditRecord,
  ConsentGrant,
  Decision,
  DenyReason,
  Recipient,
} from "./decide.js";
export { createAuthorizer } from "./authorizer.js";
export type { AuditSink, Authorizer, GrantSource } from "./authorizer.js";
