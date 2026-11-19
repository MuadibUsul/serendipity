/**
 * The consent policy, version 1: the data a person can let flow, to whom, for
 * what, and the consent scope each flow needs (ARCH-001 §4, §6, §7.3, §10).
 *
 * A flow that is not listed here is denied whatever grants exist. Bump
 * `CONSENT_POLICY_VERSION` when a flow is added or removed; raise a scope's
 * `minimumVersion` when its meaning changes, so older grants stop counting and
 * the person is asked again.
 */
export const CONSENT_POLICY_VERSION = 3;

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
  "dietary_restrictions",
  "reveal_cards",
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
  "venue_selection",
  "relationship_reveal",
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
  "venue_filter",
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
  dietary_restrictions: {
    version: 1,
    minimumVersion: 1,
    description:
      "What the person cannot eat is kept, and used only to rule out venues for their dates; never to choose people.",
  },
  relationship_reveal: {
    version: 1,
    minimumVersion: 1,
    description:
      "After both said yes, the other person turns over one card a day from your deck (soft facts you allow), and their agent may use what they saw to plan a surprise.",
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
 * Every permitted flow (policy version 2 added the dietary flows, version 3
 * the card deck). Raw voice, transcripts, photos, visual features and whole
 * profiles never go to another person or their agent (PLAN-001 §8.1); to
 * them go only allow-listed compatibility signals, chat messages and, after
 * a mutual yes, one card a day from a deck of soft facts.
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
  // Dietary restrictions can reveal religion or health (CHG-001 D4): they go
  // only to the venue filter and to the person's own agent choosing a venue,
  // never to matching, the other person or their agent.
  {
    resource: "dietary_restrictions",
    purpose: "venue_selection",
    recipient: "venue_filter",
    scope: "dietary_restrictions",
  },
  {
    resource: "dietary_restrictions",
    purpose: "venue_selection",
    recipient: "own_agent",
    scope: "dietary_restrictions",
  },
  // Policy version 3: the card deck, one card a day, to the other person of
  // an open relationship (ADR-0021). Their own agent uses what they saw on
  // their behalf, as the relationship peer.
  {
    resource: "reveal_cards",
    purpose: "relationship_reveal",
    recipient: "relationship_peer",
    scope: "relationship_reveal",
  },
];
