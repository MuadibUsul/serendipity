import { VisionError, VISION_JSON_SCHEMA } from "./schema.js";
import type { VisionProvider } from "./service.js";

/** Optional provider adapter. No call occurs unless the vision service's gate and consent pass. */
export function openAiVisionProvider(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): VisionProvider {
  if (!options.apiKey || !options.model) throw new VisionError("invalid_input");
  const send = options.fetchImpl ?? fetch;
  return {
    async extract(imageUrl) {
      if (new URL(imageUrl).protocol !== "https:") throw new VisionError("invalid_input");
      const response = await send("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          store: false,
          max_output_tokens: 300,
          instructions:
            "Describe only the three coarse, directly visible fields in the JSON schema. Use not_visible when uncertain. Never infer identity, age, gender, race, religion, health, sexuality, income, education, personality, attractiveness or relationship suitability. Do not include any other field or text.",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "Return the permitted visual observations as JSON." },
                { type: "input_image", image_url: imageUrl, detail: "low" },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "visual_features_v1",
              strict: true,
              schema: VISION_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new VisionError("provider_failed");
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        payload["status"] !== "completed" ||
        !Array.isArray(payload["output"])
      )
        throw new VisionError("provider_failed");
      for (const item of payload["output"]) {
        if (!isRecord(item) || item["type"] !== "message" || !Array.isArray(item["content"]))
          continue;
        for (const part of item["content"]) {
          if (
            isRecord(part) &&
            part["type"] === "output_text" &&
            typeof part["text"] === "string"
          ) {
            try {
              return JSON.parse(part["text"]) as unknown;
            } catch {
              throw new VisionError("invalid_output");
            }
          }
        }
      }
      throw new VisionError("provider_failed");
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
