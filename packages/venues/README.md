# @serendipity/venues

Choosing where a date happens: fair travel (CHG-001 D12,
[ADR-0017](../../docs/adr/0017-soft-distance.md)) and the dietary filter (CHG-001 D4,
[ADR-0016](../../docs/adr/0016-food-taste-and-dietary-restrictions.md)). Pure.

- `dietaryNeedsOf(facts, granted)` reads a person's `date.dietary_restrictions`, but only while
  they hold the `dietary_restrictions` consent. Without it, it reads nothing; once the consent is
  revoked, the next call reads nothing.
- `suitableVenues(venues, [needsA, needsB])` keeps the venues that serve everyone's restrictions,
  in their original order.
  - Only everyone's needs together count. So the result never shows whose restriction ruled a
    venue out, or what it was.
  - A small, conservative table of implications applies:
    - a vegan venue also serves vegetarians, and people who avoid dairy or eggs;
    - a halal or kosher venue also serves people who avoid pork;
    - a kosher venue also serves people with a shellfish allergy.

This is the only place dietary restrictions are read. Matching (`decidePair`, recall, ranking) never
sees them; the tests in `@serendipity/profile` and the recall database suite prove it.

Food taste (`date.cuisines`, `date.tastes`, `date.atmosphere`, `date.price_band`) is soft. It
feeds ranking and the agents' venue negotiation (`ser-p03-10`); it never filters people.

## Fair travel

`fairVenues(venues, a, b, fit, estimate)` keeps the venues each person can reach within their
tolerance (`toleranceFor`: their stated minutes, 45 if unstated, stretched by up to 50% as the
pair's fit rises). It orders them so that the longer of the two journeys is as short as possible.
It returns the venues only: no home areas and no journey times.
