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

9. **Visual language: Apple White Liquid Glass**, from the owner's brief (2026-11-12): white
   dominates, glass is clear and thin, and a soft coral (`#ff6b81`) appears only as an accent.
   - **Glass:** iOS 26 draws Apple's own material (`expo-glass-effect`). Older iOS and Android use a
     light blur (`expo-blur`). The web uses CSS `backdrop-filter`. All three put a hairline of light
     on the edge and a soft, low-contrast shadow under it. A faint pearl and coral ambient light
     sits behind the glass, drawn with `react-native-svg`.
   - **Shape and type:** continuous (squircle) corners via `borderCurve`. Apple's type scale, in SF
     Pro and PingFang SC; the web asks for the same fonts.
   - **Layout:** grouped glass lists with hairlines instead of bordered cards; a floating glass tab
     bar with thin line icons and a white pill for the selected page.
   - **Moments:** the date is an invitation card, with the time large and light and a gentle "还有 N
     天" rather than a ticking countdown. The voice entry is a breathing glass orb, still when the
     person asks for reduced motion. Empty pages get a line drawing and one warm sentence.
   - **Contrast came first:** where the brief's colours fall short of WCAG AA, they were adjusted.
     - Secondary text `#747982` (4.38:1 on white) became `#6b7079` (4.98:1); in the 剧集版
       below it is `#4e525a`.
     - The coral is 2.74:1, so it stays decorative. A deeper `#c9304a` carries coral text and
       `#e8435e` carries state (toggle on, selected icon).
     - The primary action is an ink capsule with white text.
   - **No photography:** the brief asks for editorial photography, but before a date the product
     shows no person's photo (PRD-001 §5.3), and we hold no licensed images. Warmth comes from light,
     line drawings and words.
   - **Light only for now:** a dark Liquid Glass scheme is a later design decision.
   - **The 柔光 (soft light) design, 克制版, chosen by the owner on 2026-11-13** after a
     high-fidelity board of two intensities, inspired by the pastel world of Black Mirror's
     "Nosedive" (its look only: no ratings, scores or photos, which the PRD forbids):
     - white pages with faint fields of blush, mint, peach and powder blue behind the glass;
     - the coral orb as the brand mark;
     - the sign-in line and three floating promise pills;
     - the voice orb with rings of light;
     - the invitation card with an 84 pt Outfit ExtraLight time and a coral halo.

     Outfit (OFL) is loaded for numerals and Latin labels; Chinese stays in the system font.
     The arrival ("见面揭晓") screen waits for check-in (`ser-p04-08`).

   - **Changed to the 剧集版 (episode) intensity by the owner on 2026-11-18.** It is the other
     board of that day, closer to the colour of "Nosedive", still with no ratings, scores or
     photos:
     - a blush-white page (`#fff7f8`) lit by five saturated fields (blush, mint, peach, powder
       blue and the new lavender) at strength 0.82, in each draft's own layout;
     - clearer glass (0.5 white, `blur(30px) saturate(180%)` on the web) with a plum-tinted shadow;
     - the voice orb in the page's own five colours with a white shine and white rings, instead of
       coral;
     - a stronger coral halo under the invitation, and a coral tint for its day badge;
     - the three sign-in promises in mint, peach and blush glass;
     - the selected tab in near-white glass with a faint coral lift.

     Contrast was rechecked with the light composited at its strongest point. The draft's
     secondary grey `#5c616a` fell to 3.84:1 straight on the blush light (the AI page), so it
     became `#4e525a` (4.84:1 there). Coral text became `#b12a42`, which stays AA on the coral
     badge over every light. `tokens.test.ts` now checks text on glass over each light, and
     secondary text straight on it.

   - **The code step:** six cells that verify on the sixth digit (no button); a wrong code
     shakes, clears and says why; the number with an inline "修改"; one resend control that counts
     down.
   - **Borrowed patterns, not styles:** the six-cell code input (one real field underneath for
     typing, paste and SMS autofill) and the loading skeleton follow BoardUI's Input OTP and
     Skeleton (MIT). They were rewritten for React Native in this design language; no code or
     visual style was copied. Gallery sites such as recent.design carry no reuse terms and are
     used for reference only.

## Consequences

- `npm ci` installs the Expo toolchain for every job, including the API image build: more download
  time, with no effect on the API image itself, which keeps only the API's runtime packages.
- The simulator check (`pages`, MANUAL) still needs a person with Xcode or Android Studio. The web
  build was driven in Chromium as a stand-in, with no errors and every control at least 44 pt. The
  native glass (iOS 26 material, Android blur) has only been seen on the web fallback so far.
- Sign-in by phone and code is a placeholder: the real method is decided with identity
  (`ser-p00-04`) and the API.
- No session is persisted across launches yet. That needs secure storage and a real token, and
  comes with the API client.

## Amendment (2026-11-19): stay small, go deep

Owner direction: keep the app clean and uncluttered, and never let it grow into a do-everything
super-app. New features win their place through hierarchy, not new surfaces.

1. **Four tabs, never more:** AI, Dates, Relationships, Me. A new feature lives inside one of
   them.
2. **One primary action per screen.** Everything else is one tap deeper: a sheet, a detail page,
   or an overflow menu.
3. **Show what matters now.** Each tab's first screen shows the current state (the next date, the
   card of the day, an open chat). Settings and history sit below it.
4. **Rare and serious actions are reachable but quiet.** Pause, report, block, delete, the card
   deck settings and the dietary consent all live in a detail page or in Me, never on a primary
   surface. Help in an emergency is the exception: it is one tap away during a date.
5. **No feeds, badges or counters that pull people back.** A notification is sent only for
   something the person must act on.
6. **Before adding a screen,** a change says which existing screen it sits under and what it
   leaves out.
