# ADR-0010: The mobile app shell

- **Status:** accepted
- **Date:** 2026-11-12
- **Task:** `ser-p01-06`

## Context

PRD-001 §3.1 gives the app four pages (AI, 约会, 关系, 我) and no feed. ARCH-001 §2 picks React
Native + Expo. The task asks for those pages, sign-in, the notification permission and design
tokens, against a mock backend, with basic accessibility checked automatically and the checks in
`npm run check`.

## Decision

1. **Expo SDK 58** (React Native 0.88, React 19.3), at the exact versions Expo's own template pins.
   `apps/mobile` is an npm workspace like the others.
2. **No navigation library yet.** The flow (signed out → notification explainer → four pages) is a
   pure reducer, and the tab bar is a component. That is all four fixed pages need, and the reducer
   can be tested without a renderer. When deep links or stacked screens arrive (invitation links,
   chat threads), expo-router replaces the tab bar; the reducer's rules carry over.
3. **A mock backend behind an `Api` interface** (`src/api`). `index.ts` picks the mock; the real
   client implements the same interface once `services/api` serves these routes. The date type has
   no field for anything about the other person, so no screen can show it before the two people
   meet (PRD-001 §5.3, ARCH-001 ADR-006).
4. **Notification permission behind an interface.** An explainer comes first, because the system
   prompt can be shown only once. "Later" is always offered. Any failure reads as `unavailable`, and
   the app carries on. Web builds report `unavailable`, since push is a native feature here.
5. **Accessibility is built into `src/ui`.** Screens import no raw `Text`, `TextInput` or
   `Pressable`; a source test enforces it. The primitives:
   - use `role` / `aria-*` props;
   - never disable font scaling;
   - never fix heights around text;
   - make every control at least the platform's touch target.

   `aria-*` was chosen over `accessibilityState` because react-native-web ignores
   `accessibilityState`: tabs were not announced as selected until this was changed.

6. **Design tokens in `packages/ui`**, plain values with contrast tests, shared with the merchant and
   ops web apps later.
7. **Tests through react-native-web in jsdom**, in the root Vitest run. `react-native` is aliased to
   `react-native-web`; `.web.*` files resolve first, as Metro does for web. This catches flow and
   accessibility mistakes without a simulator. It cannot see native behaviour.
8. **Metro reads the shared packages unchanged.** They are written for NodeNext (`import "./x.js"`
   meaning `x.ts`). `metro.config.js` resolves such imports to the TypeScript source, for the
   repository's own files only, never in `node_modules`.

## Consequences

- `npm ci` installs the Expo toolchain for every job, including the API image build: more download
  time, with no effect on the API image itself, which keeps only the API's runtime packages.
- The simulator check (`pages`, MANUAL) still needs a person with Xcode or Android Studio. The web
  build was driven in Chromium as a stand-in, with no errors and every control at least 44 pt.
- Sign-in by phone and code is a placeholder: the real method is decided with identity
  (`ser-p00-04`) and the API.
- No session is persisted across launches yet. That needs secure storage and a real token, and
  comes with the API client.
