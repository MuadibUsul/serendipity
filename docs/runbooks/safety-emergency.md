# Runbook: safety reports and emergencies

Owner: the safety on-call. Applies to: China pilot. Related: [ADR-0022](../adr/0022-reports-and-bans.md).

The app never decides about a person on its own. It holds and queues; a person decides.

## 1. Someone is in danger now

1. The app's help button shows the emergency numbers: 110 police, 120 ambulance. Tell the person to
   call them first. We are not an emergency service.
2. If the person reaches us during or right after a date, stay with them on the line until they are
   safe or emergency services take over.
3. File or find the report, then follow §2 as a high-risk case.

## 2. A high-risk report (threat or violence, sexual misconduct, stalking, suspected minor)

What the system already did, automatically:

- The reported person is held from matching (`users.match_hold_at`).
- Chat between the two is closed.
- The two can never be matched again (`user_blocks`).

Within **2 hours**, the on-call:

1. Takes the oldest open high-risk report from the queue (`queue()`; high risk comes first).
2. Reads the category and details. Asks the reporter for more only through the app's support
   channel, never by calling from a personal phone.
3. Decides:
   - `suspend` when the report is credible. The account is suspended, and sign-in and chat stop.
   - `warn` when the report is real but minor. The hold is released.
   - `dismiss` when the report is unfounded. The hold is released.
4. A suspected minor is always `suspend`, pending identity review with the verification vendor.
5. If the report describes a crime, tell the reporter how to go to the police. Hand data to the
   authorities only on a lawful request, through legal.

## 3. A standard report

Decide within **3 days**. Nobody is held while a standard report is open, but the two are already
blocked from meeting again.

## 4. Appeals

A suspended person cannot sign in, so they appeal through the support email or phone line.

1. Record the appeal (`recordAppeal`) with their own words.
2. A **different** staff member from the one who suspended decides within **7 days**:
   - `upheld`: the account stays suspended;
   - `overturned`: the account is restored, unless another suspension stands against it.
3. Tell the person the outcome. Never tell them who reported them or what was said.

## 5. What we never do

- Tell the reported person who reported them, or quote the report.
- Tell the reporter what happened to the other person's account.
- Contact anyone off-platform with their personal details.
- Act on a single unverified report as if it were proven. Suspend only after reading it.

## Open items for the owner

- Staff accounts and who may decide; whether a suspension needs two people.
- The support channel for appeals: email address, phone line and hours.
