# ADR-0021: After a mutual yes, one card a day

- Status: accepted
- Date: 2026-11-19
- Decision by: the owner (feature and the three settings below)
- Inputs: PRD-001 §7, §8.2; [ADR-0019](0019-private-feedback.md), [ADR-0020](0020-mutual-chat.md)

## Context

After both said yes, the two agents know a lot that could make the next date a lovely surprise.
The owner wants that knowledge to open up between them gradually, as a game. Each day a person
chooses a card to turn over and learns one more thing about the other.

## Decision

1. **A card is one item of a soft fact**: one interest, one way of talking, one habit, one
   favourite cuisine, one taste or one kind of place.
   - Dietary restrictions join a deck only if the owner adds them and holds the dietary consent
     (ADR-0016).
   - Never cards: home area, age and age range, budget, availability, relationship goals,
     appearance wishes, occupation, photos and contact details.
   - The owner can take any category out at any time. A card already turned over from that
     category is then hidden again.
2. **The person chooses the category; the server picks the card.** The face-down deck shows only
   how many cards are left in each category, never their items.
3. **One card a day.** The day is the local day in China (UTC+8).
4. **In step.** Nobody may be more than one card ahead of the other, unless the other has already
   seen the whole deck.
5. **Consent and state.**
   - Both people must hold the new `relationship_reveal` consent (consent policy version 3).
     Its only flow is `reveal_cards` to the relationship peer, whose own agent may use what the
     peer saw to plan the next date.
   - Everything stops and is hidden once chat closes: after leaving, after a block, or while
     either person is paused or inactive (ADR-0020).
6. **Privacy.**
   - Audits name the category, never the card.
   - The data export includes a person's deck settings. The cards they saw belong to the other
     person, so they are not exported.
   - Deleting either account deletes every card turned over in the relationship.

## Consequences

- The app needs a consent prompt for the cards, deck settings, and the daily card ritual (UI).
- The planning agent (`ser-p03-10` and later) reads the cards a person has seen through this
  repository, and only for that person's dates with the card owner.

## Amendment (2026-11-20)

The day now follows the market's time zone (`@serendipity/market`). For the Bay Area that is
Pacific time, with daylight saving handled (ADR-0023). It no longer follows UTC+8.
