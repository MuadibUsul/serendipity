/**
 * The consent policy, version 1: the data a person can let flow, to whom, for
 * what, and the consent scope each flow needs (ARCH-001 §4, §6, §7.3, §10).
 *
 * A flow that is not listed here is denied whatever grants exist. Bump
 * `CONSENT_POLICY_VERSION` when a flow is added or removed; raise a scope's
 * `minimumVersion` when its meaning changes, so older grants stop counting and
 * the person is asked again.
 */
export const CONSENT_POLICY_VERSION = 1;

/** Kinds of personal data the engine guards. */
export const RESOURCES = [
  "voice_audio",
  "transcript",
  "profile_facts",
  "match_photos",
  "visual_features",
  "compatibility_signals",
  "chat_messages",
  "booking_details",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const PURPOSES = [
  "profile_interview",
  "profile_extraction",
  "matching",
  "visual_features",
  "negotiation",
  "relationship_messaging",
  "date_booking",
] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Who receives data, as stored in `app.consent_grants.recipient_class`. */
export const RECIPIENT_CLASSES = [
  "own_agent",
  "counterpart_agent",
  "relationship_peer",
  "voice_provider",
  "vision_provider",
  "profile_extractor",
  "matching_service",
  "venue",
] as const;
export type RecipientClass = (typeof RECIPIENT_CLASSES)[number];

/** Recipients that act for another person than the data subject. */
export const OTHER_PERSON_RECIPIENTS: readonly RecipientClass[] = [
  "counterpart_agent",
  "relationship_peer",
];

export interface Scope {
  /** The version a new grant records. */
  readonly version: number;
  /** Grants below this version no longer count. */
  readonly minimumVersion: number;
  readonly description: string;
}

export const SCOPES = {
  voice_processing: {
    version: 1,
    minimumVersion: 1,
    description:
      "The voice provider hears the interview; the profile extractor reads its transcript.",
  },
  profile_matching: {
    version: 1,
    minimumVersion: 1,
    description:
      "The approved profile is used to find and rank matches, and by the person's own agent.",
  },
  visual_matching: {
    version: 1,
    minimumVersion: 1,
    description: "Match photos are analysed for allow-listed visual features used in ranking.",
  },
  counterpart_disclosure: {
    version: 1,
    minimumVersion: 1,
    description:
      "Allow-listed compatibility signals are shown to a candidate's agent during negotiation.",
  },
  relationship_chat: {
    version: 1,
    minimumVersion: 1,
    description: "Messages reach the other person after both chose to continue.",
  },
  venue_booking: {
    version: 1,
    minimumVersion: 1,
    description: "The venue receives the booking details it needs to seat and check in the date.",
  },
} as const satisfies Record<string, Scope>;
export type ScopeId = keyof typeof SCOPES;

export interface Flow {
  readonly resource: Resource;
  readonly purpose: Purpose;
  readonly recipient: RecipientClass;
  readonly scope: ScopeId;
}

/**
 * Every permitted flow. Raw voice, transcripts, photos, visual features and
 * profiles never go to another person or their agent (PLAN-001 §8.1); to
 * them go only allow-listed compatibility signals and chat messages.
 */
export const FLOWS: readonly Flow[] = [
  {
    resource: "voice_audio",
    purpose: "profile_interview",
    recipient: "voice_provider",
    scope: "voice_processing",
  },
  {
    resource: "transcript",
    purpose: "profile_interview",
    recipient: "voice_provider",
    scope: "voice_processing",
  },
  {
    resource: "transcript",
    purpose: "profile_extraction",
    recipient: "profile_extractor",
    scope: "voice_processing",
  },
  {
    resource: "profile_facts",
    purpose: "matching",
    recipient: "matching_service",
    scope: "profile_matching",
  },
  {
    resource: "profile_facts",
    purpose: "negotiation",
    recipient: "own_agent",
    scope: "profile_matching",
  },
  {
    resource: "match_photos",
    purpose: "visual_features",
    recipient: "vision_provider",
    scope: "visual_matching",
  },
  {
    resource: "visual_features",
    purpose: "matching",
    recipient: "matching_service",
    scope: "visual_matching",
  },
  {
    resource: "compatibility_signals",
    purpose: "negotiation",
    recipient: "counterpart_agent",
    scope: "counterpart_disclosure",
  },
  {
    resource: "chat_messages",
    purpose: "relationship_messaging",
    recipient: "relationship_peer",
    scope: "relationship_chat",
  },
  {
    resource: "booking_details",
    purpose: "date_booking",
    recipient: "venue",
    scope: "venue_booking",
  },
];
