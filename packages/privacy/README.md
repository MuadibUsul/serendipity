# Personal data export and account deletion (P05-06)

`createPrivacyService` accepts the **authenticated person's user ID** from a trusted server context.
There is no public endpoint yet: the API does not have user authentication, and passing an ID from a
request body would expose another person's data. The service can export a person's account,
identity-verification result (not the provider reference), grants, profile versions and facts,
matching policies, photo metadata (not object keys or signed URLs), own visual observations,
invitations, feedback, redacted audit history and their
own transaction records. It does not export candidate pairs, negotiations, the other person's ID,
date machine context, webhook payloads or other people's profiles. The export uses one consistent
database snapshot.

`requestDeletionForSelf` creates one durable receipt, pauses matching and revokes all live grants in
the same transaction. `deletionStatusForSelf` reports `requested`, `purging`, `failed` or `completed`,
an attempt count, a generic failure stage and counts of retained record classes. Run
`npm run privacy:cleanup` at least once per minute in each environment. Processing waits for any
already-issued 60-second upload policy to expire, so a pending upload cannot recreate an object
after deletion. The worker deletes every
private photo and its registered derived objects through the media service. A failed storage call
leaves the receipt retryable. After all photos are gone, one database transaction deletes visual
features, media metadata, profiles and facts, matching policies, grants, identity attestations,
candidate pairs and negotiations, own invitations and feedback, relationships and related
notifications. Shared date rows lose the candidate-pair link. A trigger blocks new photo uploads or
activation after the account is paused. The audit log records request, attempt, failure and
completion without personal content.

The deletion receipt lists retained **transaction and audit classes** separately: dates and their
participant rows, check-ins, payment orders, refunds and append-only audit events. The user row is
kept as a deleted tombstone. These are the current provisional retention exceptions; legal review
must set jurisdiction-specific periods and any further exceptions before launch. This package does
not claim that a record is legally required in every region. The global webhook table has no user
key and remains outside the per-user export and purge; its redacted payload and retention policy
need separate review. New personal-data tables must extend this purge and export inventory before
they are deployed. A completed receipt means the listed code paths succeeded, including deletion
of current S3 objects; storage versioning must be disabled or noncurrent versions expired as required
by the media policy.
