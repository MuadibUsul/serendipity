# Platform review of merchant submissions

This proposed contract covers merchant self-service onboarding under PLAN-001 §4, P04-03, and its follow-up task `ser-p04-03a-review-contract`. The dedicated repository's venue package currently covers venue planning. This contract specifies a separate onboarding review that can be exercised with fictional merchants and synthetic files before G0.

## Permissions and decisions

| Actor                    | Allowed actions                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant editor          | Create and edit draft revisions for their own merchant. Submit a complete draft, see its status and read the merchant-facing rejection reason. Start a new draft from a rejected or approved revision. |
| Platform reviewer        | Read submitted revisions in their assigned review scope. Approve or reject the exact submitted revision. A separate licence-read grant within that scope is required to open its attachment.           |
| Public and booking flows | Read only explicitly published fields from the approved revision. Keep licence files, private contact details and review records restricted.                                                           |

Enforce merchant ownership, reviewer scope and attachment access on the server for every operation. Merchant staff cannot review their own merchant, even if they also hold a platform reviewer role. Reviewers cannot edit merchant submissions. A submitter can see their own attachment status. The prototype only grants attachment content access to eligible platform reviewers.

## Revision lifecycle

- A draft contains the venue address, menu items and prices, contact details and a synthetic licence attachment. Validate required fields, integer nonnegative prices in minor units with currency, and attachment ownership before submission.
- Submission freezes the revision and enters `SUBMITTED`. Allow one submitted revision per merchant at a time. Approval moves the submitted revision to `APPROVED` and updates the approved revision pointer in the same transaction. Treat approval as internal eligibility under this contract. Publication and booking remain subject to their own gates.
- Rejection moves the submitted revision to `REJECTED` and requires a merchant-facing reason, such as “Add the street number.” Keep internal notes and operational evidence restricted.
- To resubmit, copy permitted fields into a new `DRAFT`, correct the flagged issues and submit the new revision. Keep each past decision attached to its original revision. If an approved merchant proposes an update, the previous approval remains active until a replacement is approved.
- Require the expected revision and status for each decision. An exact retry returns the original result. A conflicting or stale decision leaves the approved pointer and decision history intact.

## Licence access and open legal decisions

Use a synthetic attachment stored privately. Check current reviewer assignment and licence-read permission on each fetch. Serve it through an authenticated endpoint and exclude its bytes and storage reference from general responses, exports and telemetry. Record actor, merchant, revision, timestamp, action and outcome for review decisions and attachment access. Keep attachment contents and contact values out of those records.

Legal and the owner still need to decide whether to collect real licences, which documents to accept, how to verify them, who may access them in production, and retention and deletion rules. Keep real licence intake disabled pending those decisions and the relevant launch gates.

## Acceptance matrix

Use mock merchant Cedar Table (`merchant_A`), unrelated mock merchant Juniper Lunch (`merchant_B`), assigned reviewer `reviewer_A`, unassigned reviewer `reviewer_B`, and synthetic attachment `fixture_licence_A`. Cedar Table submits 100 Example Lane, a USD 24.00 mock set menu and `cedar@example.invalid`.

| Case | Action                                                                                                                | Expected result                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | Cedar Table submits a draft with the street number missing or an attachment owned by Juniper Lunch.                   | Validation fails. The draft stays editable and no review is queued.                                                    |
| 2    | Cedar Table submits complete revision 1 twice with the same retry key.                                                | One immutable submitted revision and one queue entry result.                                                           |
| 3    | Juniper Lunch tries to read or edit Cedar Table's draft. An unassigned reviewer tries to decide revision 1.           | Both requests are denied and the revision is unchanged.                                                                |
| 4    | Cedar Table staff who also hold a reviewer role try to approve revision 1.                                            | The server denies the self-review.                                                                                     |
| 5    | An assigned reviewer without a licence-read grant opens the attachment, then repeats with the grant.                  | The first request is denied. The second returns the synthetic file. Both outcomes are audited without file contents.   |
| 6    | The assigned reviewer rejects revision 1 without a reason, then with “Correct the venue address to 102 Example Lane.” | The first request leaves it submitted. The second rejects it and shows Cedar Table the reason without internal notes.  |
| 7    | Cedar Table corrects the address and submits revision 2. The reviewer approves revision 2.                            | Revision 1 retains its rejection. Revision 2 becomes approved and is the active approved revision.                     |
| 8    | The reviewer retries the approval of revision 2, then submits a conflicting rejection.                                | The retry returns the original result. The rejection fails and the active revision remains 2 with one approval record. |
| 9    | Cedar Table submits revision 3 with a new mock menu price and the reviewer rejects it.                                | Revision 2 remains active and the rejected menu price stays private.                                                   |
| 10   | A public caller tries to read the licence via the merchant listing or attachment endpoint.                            | Only published fields are returned by the listing. The attachment request is denied.                                   |
