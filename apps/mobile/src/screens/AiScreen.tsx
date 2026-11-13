import { RADIUS, SHADOW, SPACE } from "@serendipity/ui";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";

import type { Home } from "../api/types";
import { AI_HEADLINES, AI_PAGE } from "../copy";
import { AppText } from "../ui/AppText";
import { Breathing } from "../ui/Breathing";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { IconButton } from "../ui/IconButton";
import { Ripple } from "../ui/Ripple";
import { Screen } from "../ui/Screen";
import { useMaterials, usePalette } from "../ui/theme";

const ORB = 196;

/**
 * The voice entry: a coral orb of light with a soft white rim, breathing, and
 * rings leaving it slowly. Decorative; still when motion is reduced.
 */
function VoiceOrb() {
  const materials = useMaterials();
  return (
    <View aria-hidden style={{ height: 300, alignItems: "center", justifyContent: "center" }}>
      <Ripple size={250} />
      <Breathing>
        <View
          style={{
            width: ORB + 20,
            height: ORB + 20,
            borderRadius: (ORB + 20) / 2,
            padding: 10,
            backgroundColor: "rgba(255,255,255,0.55)",
            boxShadow: SHADOW.orb,
          }}
        >
          <Svg width={ORB} height={ORB}>
            <Defs>
              <RadialGradient id="voice-orb" cx="34%" cy="28%" r="80%" fx="34%" fy="28%">
                <Stop offset="0" stopColor="#ffffff" />
                <Stop offset="0.3" stopColor="#ffe6ea" />
                <Stop offset="0.66" stopColor="#ffb3c0" />
                <Stop offset="1" stopColor={materials.glowCoral} />
              </RadialGradient>
              <RadialGradient id="voice-orb-shine" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#ffffff" stopOpacity={0.8} />
                <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={ORB / 2} cy={ORB / 2} r={ORB / 2} fill="url(#voice-orb)" />
            <Ellipse
              cx={ORB * 0.38}
              cy={ORB * 0.24}
              rx={ORB * 0.2}
              ry={ORB * 0.1}
              fill="url(#voice-orb-shine)"
              transform={`rotate(-24 ${String(ORB * 0.38)} ${String(ORB * 0.24)})`}
            />
          </Svg>
        </View>
      </Breathing>
    </View>
  );
}

/** A small glowing coral dot before a status line. */
function StatusDot() {
  const palette = usePalette();
  return (
    <View
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: palette.accent,
        boxShadow: "0px 0px 10px rgba(255,107,129,0.8)",
      }}
    />
  );
}

/** The AI page; its headline follows where the person is (PRD-001 §3.1). */
export function AiScreen({ home }: { readonly home: Home }) {
  const listening = home.state === "new" || home.state === "matching";
  return (
    <Screen ambient="ai">
      <View style={{ gap: SPACE.sm }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: SPACE.sm,
          }}
        >
          <AppText variant="title" heading>
            {AI_HEADLINES[home.state]}
          </AppText>
          {home.state === "new" ? (
            <Glass radius={RADIUS.pill} style={{ paddingHorizontal: SPACE.md, paddingVertical: 6 }}>
              <AppText variant="footnote" color="textSecondary">
                {AI_PAGE.duration}
              </AppText>
            </Glass>
          ) : null}
        </View>
        <AppText variant="subhead" color="textSecondary">
          {AI_PAGE.intro[home.state]}
        </AppText>
      </View>
      {listening ? (
        <>
          <VoiceOrb />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: SPACE.sm,
              marginTop: -SPACE.lg,
            }}
          >
            <StatusDot />
            <AppText variant="subhead" color="textSecondary">
              {home.state === "new" ? AI_PAGE.voiceSoon : AI_PAGE.searching}
            </AppText>
          </View>
        </>
      ) : null}
      {home.state === "new" ? (
        <>
          <Glass radius={RADIUS.lg} style={{ padding: SPACE.xl, gap: SPACE.sm }}>
            <AppText variant="footnote" color="accentText">
              {AI_PAGE.firstLabel}
            </AppText>
            <AppText variant="headline">{AI_PAGE.firstQuestion}</AppText>
          </Glass>
          {/* Voice arrives with ser-p02-02; the controls are shown, not live. */}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: SPACE.lg }}>
            <IconButton icon="keyboard" label={AI_PAGE.useText} hint={AI_PAGE.voiceSoon} disabled />
            <View style={{ flexShrink: 1 }}>
              <Button
                label={AI_PAGE.startVoice}
                variant="secondary"
                hint={AI_PAGE.voiceSoon}
                disabled
              />
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}
