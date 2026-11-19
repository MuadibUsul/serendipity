// Renders the persisted lifecycles as the generated part of
// docs/state-machines.md (`npm run docs:state-machines`). The test in
// state-machines.test.ts fails when the file and the tables disagree, so the
// map an agent or a person reads is always the one the code and the database
// enforce.
import type { Lifecycle } from "@serendipity/domain";
import { ACCOUNT_LIFECYCLE } from "@serendipity/identity";
import { INVITE_LIFECYCLE } from "@serendipity/invitations";
import { MEDIA_LIFECYCLE } from "@serendipity/media";
import { DELETION_LIFECYCLE } from "@serendipity/privacy";
import { VERSION_LIFECYCLE } from "@serendipity/profile";

export const LIFECYCLES: readonly {
  readonly lifecycle: Lifecycle<string>;
  readonly source: string;
}[] = [
  { lifecycle: ACCOUNT_LIFECYCLE, source: "packages/identity/src/account.ts" },
  { lifecycle: DELETION_LIFECYCLE, source: "packages/privacy/src/lifecycle.ts" },
  { lifecycle: INVITE_LIFECYCLE, source: "packages/invitations/src/lifecycle.ts" },
  { lifecycle: VERSION_LIFECYCLE, source: "packages/profile/src/lifecycle.ts" },
  { lifecycle: MEDIA_LIFECYCLE, source: "packages/media/src/lifecycle.ts" },
];

export const GENERATED_START = "<!-- generated:lifecycles:start -->";
export const GENERATED_END = "<!-- generated:lifecycles:end -->";

function render(lifecycle: Lifecycle<string>, source: string): string {
  const terminal = lifecycle.states.filter((state) => lifecycle.isTerminal(state));
  return [
    `### \`${lifecycle.name}\``,
    "",
    `Declared in \`${source}\`; enforced by \`app.guard_transition\` (migration 0009).`,
    `Starts as \`${lifecycle.initial}\`; final: ${terminal.map((state) => `\`${state}\``).join(", ")}.`,
    "",
    "```mermaid",
    "stateDiagram-v2",
    `  [*] --> ${lifecycle.initial}`,
    ...lifecycle.edges().map(([from, to]) => `  ${from} --> ${to}`),
    ...terminal.map((state) => `  ${state} --> [*]`),
    "```",
  ].join("\n");
}

/** The generated block, markers included. */
export function renderLifecycles(): string {
  return [
    GENERATED_START,
    "",
    ...LIFECYCLES.flatMap(({ lifecycle, source }) => [render(lifecycle, source), ""]),
    GENERATED_END,
  ].join("\n");
}

/** `document` with its generated block replaced by the current one. */
export function withCurrentLifecycles(document: string): string {
  const start = document.indexOf(GENERATED_START);
  const end = document.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("docs/state-machines.md: generated markers missing");
  }
  return document.slice(0, start) + renderLifecycles() + document.slice(end + GENERATED_END.length);
}
