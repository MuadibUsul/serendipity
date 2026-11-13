# @serendipity/mobile

The 不期 app: React Native + Expo SDK 58, in the Apple White Liquid Glass style (ADR-0010 §9). It has sign-in, the notification-permission explainer and
the four pages of PRD-001 §3.1, running against an on-device **mock backend**: no request leaves
the device. [ADR-0010](../../docs/adr/0010-mobile-shell.md) records the decisions.

```bash
npm run start --workspace @serendipity/mobile        # Expo dev server; press i / a for a simulator
npm run ios --workspace @serendipity/mobile
npm run android --workspace @serendipity/mobile

# Start in another account state: new (default) | matching | booked | in_relationship
EXPO_PUBLIC_MOCK_STATE=booked npm run start --workspace @serendipity/mobile

# Slow every mock answer down, to see the loading skeleton
EXPO_PUBLIC_MOCK_LATENCY_MS=1500 npm run start --workspace @serendipity/mobile

# A static web build (what the browser checks used)
npm run export:web --workspace @serendipity/mobile
```

Sign in with any 11-digit number starting with 1 and **获取验证码**; the next step asks for the
code, `000000`.

## Flow

```text
signed out ──sign in──▶ notification explainer ──allow / later──▶ AI · 约会 · 关系 · 我
                 └── (permission already decided) ───────────────▶
any page ──退出登录──▶ signed out
```

`src/shell/state.ts` holds the flow as a pure reducer. Screens send events; they never decide where
the person goes next.

| Page                | Shows                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **AI**              | A headline for the account state: 和 AI 认识一下 / 正在寻找 / 下一场约会 / 暂停匹配                |
| **约会**            | Time, venue, package, **your own** share and the cancel rule. Nothing about the other person       |
| **关系**            | Only people both sides chose to continue with                                                      |
| **我**              | Verification status, notifications, pause matching, privacy, sign out                              |
| Notification primer | Why notifications are sent, before the one-time system prompt. "以后再说" keeps it for the 我 page |

Voice (`ser-p02-02`), chat (`ser-p05-02`), the help desk (`ser-p04-10`) and the consent page are
shown as disabled controls until their tasks land.

## Layout

```text
index.ts              entry: mock API + expo-notifications
metro.config.js       lets Metro read the shared packages' "./x.js" → x.ts imports
src/App.tsx           providers, shell, data loading
src/shell/state.ts    the flow (pure)
src/api/              types the app reads, and the mock backend
src/platform/         notification permission: interface, Expo adapter, fake
src/ui/               the only place that touches Text, TextInput, Pressable: glass
                      (Glass.tsx native, Glass.web.tsx web), icons, drawings, motion
src/screens/          one file per screen
src/copy.ts           all product copy (Chinese) in one place
```

## Accessibility

- **Names:** every control's accessible name is its visible label, given with `role` and `aria-*`
  props, which React Native 0.71+ and react-native-web both understand.
- **Contrast:** colours come from `@serendipity/ui`, and every text/background pair meets WCAG AA.
  The brand coral is decorative only; a deeper coral carries text and state.
- **Dynamic type:** font scaling is never turned off or capped. No height is fixed around text, and
  every page scrolls.
- **Touch targets:** at least 44 pt on iOS and web, 48 dp on Android. Settings rows are pressable
  across their whole width.
- **Motion:** the breathing voice orb stands still when the person asks for reduced motion.
- **Headings:** every page, including the loading and error states, starts with a heading.

`src/a11y.test.tsx` renders every screen in every account state, and checks names, headings,
rendered contrast and fixed heights. `src/source-rules.test.ts` keeps raw text and
pressables inside `src/ui`, and keeps font scaling on.

## Tests

The tests render through react-native-web in jsdom; see the root `vitest.config.ts`. They need no
simulator and run in `npm run check`. A device or simulator is still the check for anything native,
such as the real permission prompt.
