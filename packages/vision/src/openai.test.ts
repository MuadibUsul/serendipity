import { describe, expect, it } from "vitest";

import { openAiVisionProvider } from "./openai.js";
import { VALID } from "./schema.test.js";

describe("optional OpenAI vision adapter", () => {
  it("sends one low-detail private image with a strict schema and no response storage", async () => {
    let request: Record<string, unknown> | null = null;
    const fetchImpl: typeof fetch = (_input, init) => {
      request = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              { type: "message", content: [{ type: "output_text", text: JSON.stringify(VALID) }] },
            ],
          }),
          { status: 200 },
        ),
      );
    };
    const adapter = openAiVisionProvider({
      apiKey: "synthetic-test-key",
      model: "vision-test",
      fetchImpl,
    });
    expect(await adapter.extract("https://private.invalid/opaque?signature=test")).toEqual(VALID);
    expect(request).toMatchObject({
      model: "vision-test",
      store: false,
      input: [
        {
          content: [
            { type: "input_text" },
            {
              type: "input_image",
              detail: "low",
              image_url: "https://private.invalid/opaque?signature=test",
            },
          ],
        },
      ],
      text: {
        format: { type: "json_schema", strict: true, schema: { additionalProperties: false } },
      },
    });
    expect(JSON.stringify(request)).not.toContain("synthetic-test-key");
  });

  it("fails closed on incomplete or refused responses", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "incomplete",
            output: [{ type: "message", content: [{ type: "refusal" }] }],
          }),
          { status: 200 },
        ),
      );
    const adapter = openAiVisionProvider({
      apiKey: "synthetic-test-key",
      model: "vision-test",
      fetchImpl,
    });
    await expect(adapter.extract("https://private.invalid/opaque")).rejects.toMatchObject({
      code: "provider_failed",
    });
  });
});
