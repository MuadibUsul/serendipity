/** Only directly observable, coarse descriptors. No free-form model text is persisted. */
export const HAIR_LENGTHS = ["short", "medium", "long", "not_visible"] as const;
export const CLOTHING_STYLES = ["casual", "formal", "sporty", "other", "not_visible"] as const;
export const PHOTO_STYLES = ["natural", "studio", "outdoor", "other", "not_visible"] as const;

interface Observation<T extends string> {
  readonly value: T;
  readonly confidence: number;
}

export interface VisionFeatures {
  readonly hair_length: Observation<(typeof HAIR_LENGTHS)[number]>;
  readonly clothing_style: Observation<(typeof CLOTHING_STYLES)[number]>;
  readonly photo_style: Observation<(typeof PHOTO_STYLES)[number]>;
}

const observationSchema = (values: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "string", enum: values },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["value", "confidence"],
});

/** The provider receives this strict schema, and its answer is validated again locally. */
export const VISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hair_length: observationSchema(HAIR_LENGTHS),
    clothing_style: observationSchema(CLOTHING_STYLES),
    photo_style: observationSchema(PHOTO_STYLES),
  },
  required: ["hair_length", "clothing_style", "photo_style"],
} as const;

export class VisionError extends Error {
  constructor(
    readonly code:
      | "disabled"
      | "forbidden"
      | "not_found"
      | "invalid_input"
      | "invalid_output"
      | "provider_failed",
  ) {
    super(code);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(value);
  return found.length === keys.length && found.every((key) => keys.includes(key));
}

function observation<T extends string>(value: unknown, allowed: readonly T[]): Observation<T> {
  if (
    !record(value) ||
    !exactKeys(value, ["value", "confidence"]) ||
    typeof value["value"] !== "string" ||
    !allowed.includes(value["value"] as T) ||
    typeof value["confidence"] !== "number" ||
    !Number.isFinite(value["confidence"]) ||
    value["confidence"] < 0 ||
    value["confidence"] > 1
  )
    throw new VisionError("invalid_output");
  return { value: value["value"] as T, confidence: value["confidence"] };
}

/** Rejects unknown keys and values, including identity, demographic and personality claims. */
export function parseVisionFeatures(value: unknown): VisionFeatures {
  if (!record(value) || !exactKeys(value, VISION_JSON_SCHEMA.required))
    throw new VisionError("invalid_output");
  return {
    hair_length: observation(value["hair_length"], HAIR_LENGTHS),
    clothing_style: observation(value["clothing_style"], CLOTHING_STYLES),
    photo_style: observation(value["photo_style"], PHOTO_STYLES),
  };
}
