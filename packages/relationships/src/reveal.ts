/**
 * Getting to know each other, one card a day (owner decision, 2026-11-19;
 * ADR-0021).
 *
 * After both people said yes, each may turn over one card a day from the
 * other's deck. A card is one item of the other person's profile: one
 * interest, one favourite cuisine, one taste. The person chooses the
 * category; which item in it turns over is the server's pick, so the
 * face-down deck gives nothing away. What has been turned over helps their
 * own agent plan a surprise for the next date.
 *
 * - The deck holds only soft, harmless facts by default. Dietary
 *   restrictions join only if their owner adds them (and holds the dietary
 *   consent). Home area, age, budget, availability, appearance wishes,
 *   occupation, photos and contact details are never cards.
 * - Each owner can take a category out of their deck at any time; a card
 *   already turned over from it is then hidden again.
 * - The two stay in step: nobody may be more than one card ahead of the
 *   other, unless the other has already seen the whole deck.
 * - Everything stops while chat is closed: left, blocked, or either person
 *   inactive. Each person must hold the `relationship_reveal` consent.
 */

import { MARKET, startOfLocalDay } from "@serendipity/market";

/** Days start at local midnight in the market's time zone (Pacific time for the Bay Area). */
export const DAY_TIME_ZONE = MARKET.timeZone;
export const CARDS_PER_DAY = 1;

/** Categories in every deck unless their owner takes them out. */
export const DEFAULT_CATEGORIES = [
  "self.interests",
  "self.communication_style",
  "self.lifestyle",
  "date.cuisines",
  "date.tastes",
  "date.atmosphere",
] as const;

/** Categories only their owner can put in. */
export const OPT_IN_CATEGORIES = ["date.dietary_restrictions"] as const;

export type Category = (typeof DEFAULT_CATEGORIES)[number] | (typeof OPT_IN_CATEGORIES)[number];

const ALL: readonly string[] = [...DEFAULT_CATEGORIES, ...OPT_IN_CATEGORIES];
export const isCategory = (key: string): key is Category => ALL.includes(key);

export interface DeckSettings {
  /** Default categories the owner took out. */
  readonly excluded: readonly Category[];
  /** Opt-in categories the owner put in. */
  readonly included: readonly Category[];
  /** The owner holds the dietary consent (`dietary_restrictions`). */
  readonly dietaryConsent: boolean;
}

export const DEFAULT_SETTINGS: DeckSettings = { excluded: [], included: [], dietaryConsent: false };

/** The categories in a deck now. */
export function categoriesOf(settings: DeckSettings): Category[] {
  const defaults = DEFAULT_CATEGORIES.filter((key) => !settings.excluded.includes(key));
  // The only opt-in category is dietary restrictions, which also needs its own consent.
  const optIn = OPT_IN_CATEGORIES.filter(
    (key) => settings.included.includes(key) && settings.dietaryConsent,
  );
  return [...defaults, ...optIn];
}

/** A profile value as items: a list of tags, a list of weighted tags, or one choice. */
function itemsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item === "string") return [item];
    if (typeof item === "object" && item !== null && "tag" in item) {
      const tag = item.tag;
      return typeof tag === "string" ? [tag] : [];
    }
    return [];
  });
}

export interface Card {
  readonly category: Category;
  readonly item: string;
}

/** Every card in an owner's deck: their current facts, only from allowed categories. */
export function deckOf(facts: ReadonlyMap<string, unknown>, settings: DeckSettings): Card[] {
  return categoriesOf(settings).flatMap((category) =>
    [...new Set(itemsOf(facts.get(category)))].sort().map((item) => ({ category, item })),
  );
}

/** What the viewer sees of a deck: how many cards are left face down in each category. */
export function faceDown(
  deck: readonly Card[],
  seen: readonly Card[],
): { readonly category: Category; readonly remaining: number }[] {
  const shown = new Set(seen.map((card) => `${card.category}\u0000${card.item}`));
  const counts = new Map<Category, number>();
  for (const card of deck) {
    if (shown.has(`${card.category}\u0000${card.item}`)) continue;
    counts.set(card.category, (counts.get(card.category) ?? 0) + 1);
  }
  return [...counts].map(([category, remaining]) => ({ category, remaining }));
}

/** The cards the viewer may still see: turned over before, and still in the owner's deck. */
export function stillShown(deck: readonly Card[], seen: readonly Card[]): Card[] {
  const live = new Set(deck.map((card) => `${card.category}\u0000${card.item}`));
  return seen.filter((card) => live.has(`${card.category}\u0000${card.item}`));
}

export type FlipRefusal =
  "closed" | "no_consent" | "daily_limit" | "wait_for_them" | "category_empty";

export interface FlipState {
  /** Chat is open between the two (chatRefusal is null or only the viewer's chat consent). */
  readonly open: boolean;
  /** Both hold the `relationship_reveal` consent. */
  readonly bothConsent: boolean;
  /** Cards the viewer turned over today (local day). */
  readonly flippedToday: number;
  /** Cards the viewer has turned over in all. */
  readonly mine: number;
  /** Cards the other person has turned over in all. */
  readonly theirs: number;
  /** Cards in the viewer's own deck: when the other has seen them all, step is lifted. */
  readonly myDeckSize: number;
  /** Cards still face down in the chosen category of the other's deck. */
  readonly remainingInCategory: number;
}

export function flipRefusal(state: FlipState): FlipRefusal | null {
  if (!state.open) return "closed";
  if (!state.bothConsent) return "no_consent";
  if (state.flippedToday >= CARDS_PER_DAY) return "daily_limit";
  if (state.mine > state.theirs && state.theirs < state.myDeckSize) return "wait_for_them";
  if (state.remainingInCategory <= 0) return "category_empty";
  return null;
}

/** The start of `now`'s local day, as an instant (daylight saving included). */
export function startOfDay(now: Date): Date {
  return startOfLocalDay(now, DAY_TIME_ZONE);
}
