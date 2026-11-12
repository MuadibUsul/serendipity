// Validating and normalising fact values against the catalog. Values come
// from an extractor (untrusted model output) or from a person's edits; both
// go through here. Normalised values compare equal when they mean the same
// thing (sets are sorted, windows ordered).
import { WEEKDAYS } from "./catalog.js";
import type { FactSpec, ValueSpec, Weekday } from "./catalog.js";

export type FactValue =
  | string
  | number
  | readonly string[]
  | { readonly min: number; readonly max: number }
  | readonly { readonly tag: string; readonly weight: 1 | 2 | 3 }[]
  | readonly { readonly day: Weekday; readonly from: string; readonly to: string }[]
  | { readonly currency: string; readonly max_minor: number };

export type ValueResult =
  | { readonly ok: true; readonly value: FactValue }
  | { readonly ok: false; readonly problem: string };

/**
 * Tags are short lower-case words. They may not hold a run of five digits, so
 * a phone or ID number cannot be stored as a "tag".
 */
const TAG = /^[a-z][a-z0-9_]{0,31}$/;
const DIGIT_RUN = /\d{5}/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const fail = (problem: string): ValueResult => ({ ok: false, problem });
const ok = (value: FactValue): ValueResult => ({ ok: true, value });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTag = (value: unknown): value is string =>
  typeof value === "string" && TAG.test(value) && !DIGIT_RUN.test(value);

function uniqueSorted(values: readonly string[]): string[] | undefined {
  const sorted = [...values].sort();
  return sorted.every((value, i) => i === 0 || value !== sorted[i - 1]) ? sorted : undefined;
}

function checkTags(value: unknown, maxItems: number): ValueResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    return fail(`must be a list of 1 to ${String(maxItems)} tags`);
  }
  if (!value.every(isTag)) return fail("tags are lower-case words of letters, digits and _");
  const tags = uniqueSorted(value);
  return tags === undefined ? fail("tags must not repeat") : ok(tags);
}

function checkWeightedTags(value: unknown, maxItems: number): ValueResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    return fail(`must be a list of 1 to ${String(maxItems)} weighted tags`);
  }
  const items: { tag: string; weight: 1 | 2 | 3 }[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item) || !isTag(item["tag"])) return fail("each item needs a tag");
    const weight = item["weight"];
    if (weight !== 1 && weight !== 2 && weight !== 3) return fail("weights are 1, 2 or 3");
    items.push({ tag: item["tag"], weight });
  }
  items.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  if (items.some((item, i) => i > 0 && item.tag === items[i - 1]?.tag)) {
    return fail("tags must not repeat");
  }
  return ok(items);
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function checkWindows(value: unknown, maxItems: number): ValueResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    return fail(`must be a list of 1 to ${String(maxItems)} weekly windows`);
  }
  const windows: { day: Weekday; from: string; to: string }[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return fail("each window is { day, from, to }");
    const { day, from, to } = item;
    if (typeof day !== "string" || !(WEEKDAYS as readonly string[]).includes(day)) {
      return fail("day is mon to sun");
    }
    if (typeof from !== "string" || typeof to !== "string" || !TIME.test(from) || !TIME.test(to)) {
      return fail("times are HH:MM");
    }
    if (minutes(from) >= minutes(to)) return fail("a window must end after it starts");
    windows.push({ day: day as Weekday, from, to });
  }
  const order = (w: { day: Weekday; from: string }) =>
    WEEKDAYS.indexOf(w.day) * 1440 + minutes(w.from);
  windows.sort((a, b) => order(a) - order(b));
  for (let i = 1; i < windows.length; i += 1) {
    const before = windows[i - 1];
    const after = windows[i];
    if (
      after !== undefined &&
      before?.day === after.day &&
      minutes(after.from) < minutes(before.to)
    ) {
      return fail("windows on one day must not overlap");
    }
  }
  return ok(windows);
}

function checkValue(spec: ValueSpec, value: unknown): ValueResult {
  switch (spec.kind) {
    case "choice":
      return typeof value === "string" && spec.options.includes(value)
        ? ok(value)
        : fail(`must be one of ${spec.options.join(", ")}`);
    case "choices": {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > spec.maxItems ||
        !value.every((item) => typeof item === "string" && spec.options.includes(item))
      ) {
        return fail(`must be 1 to ${String(spec.maxItems)} of ${spec.options.join(", ")}`);
      }
      const choices = uniqueSorted(value as string[]);
      return choices === undefined ? fail("choices must not repeat") : ok(choices);
    }
    case "tags":
      return checkTags(value, spec.maxItems);
    case "weighted_tags":
      return checkWeightedTags(value, spec.maxItems);
    case "region":
      return typeof value === "string" && spec.pattern.test(value)
        ? ok(value)
        : fail("must be a region code such as GZ_CORE");
    case "int":
      return Number.isInteger(value) &&
        (value as number) >= spec.min &&
        (value as number) <= spec.max
        ? ok(value as number)
        : fail(
            `must be a whole number of ${spec.unit} from ${String(spec.min)} to ${String(spec.max)}`,
          );
    case "range": {
      if (!isRecord(value)) return fail("must be { min, max }");
      const { min, max } = value;
      if (
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        (min as number) < spec.min ||
        (max as number) > spec.max ||
        (min as number) > (max as number)
      ) {
        return fail(
          `must be ${spec.unit} with ${String(spec.min)} <= min <= max <= ${String(spec.max)}`,
        );
      }
      return ok({ min: min as number, max: max as number });
    }
    case "weekly_windows":
      return checkWindows(value, spec.maxItems);
    case "money": {
      if (!isRecord(value)) return fail("must be { currency, max_minor }");
      const { currency, max_minor: maxMinor } = value;
      if (typeof currency !== "string" || !spec.currencies.includes(currency)) {
        return fail(`currency must be one of ${spec.currencies.join(", ")}`);
      }
      if (
        !Number.isInteger(maxMinor) ||
        (maxMinor as number) < 0 ||
        (maxMinor as number) > spec.maxMinor
      ) {
        return fail(`max_minor must be a whole number from 0 to ${String(spec.maxMinor)}`);
      }
      return ok({ currency, max_minor: maxMinor as number });
    }
  }
}

/** `value` checked against the fact's schema, normalised; or why it does not fit. */
export function validateValue(spec: FactSpec, value: unknown): ValueResult {
  return checkValue(spec.value, value);
}

/** A stable text form of a normalised value, for comparing two of them. */
export function valueKey(value: FactValue): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
}

export function sameValue(a: FactValue, b: FactValue): boolean {
  return valueKey(a) === valueKey(b);
}
