import { RADIUS, SPACE } from "@serendipity/ui";
import { View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import type { Home } from "../api/types";
import { AI_HEADLINES, AI_PAGE } from "../copy";
import { AppText } from "../ui/AppText";
import { Breathing } from "../ui/Breathing";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Icon } from "../ui/Icon";
import { Screen } from "../ui/Screen";
import { useMaterials, usePalette } from "../ui/theme";

const ORB = 184;

/** The voice entry: a glass orb with a soft coral glow, breathing slowly. Decorative. */
function VoiceOrb() {
  const palette = usePalette();
  const materials = useMaterials();
  return (
    <View
      aria-hidden
      style={{
        alignItems: "center",
        justifyContent: "center",
        width: ORB * 1.6,
        height: ORB * 1.6,
      }}
    >
      <View style={{ position: "absolute" }}>
        <Svg width={ORB * 1.6} height={ORB * 1.6}>
          <Defs>
            <RadialGradient id="orb-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0.45" stopColor={materials.glowCoral} stopOpacity={0.16} />
              <Stop offset="1" stopColor={materials.glowCoral} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={ORB * 0.8} cy={ORB * 0.8} r={ORB * 0.8} fill="url(#orb-glow)" />
        </Svg>
      </View>
      <Breathing>
        <Glass
          raised
          radius={RADIUS.pill}
          style={{ width: ORB, height: ORB, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="mic" color={palette.accentStrong} size={44} />
        </Glass>
      </Breathing>
    </View>
  );
}

/** The AI page; its headline follows where the person is (PRD-001 §3.1). */
export function AiScreen({ home }: { readonly home: Home }) {
  const listening = home.state === "new" || home.state === "matching";
  return (
    <Screen>
      <View style={{ gap: SPACE.md }}>
        <AppText variant="largeTitle" heading>
          {AI_HEADLINES[home.state]}
        </AppText>
        <AppText color="textSecondary">{AI_PAGE.intro[home.state]}</AppText>
      </View>
      {listening ? (
        <View style={{ alignItems: "center", gap: SPACE.lg }}>
          <VoiceOrb />
          {home.state === "new" ? (
            <View style={{ alignSelf: "stretch", gap: SPACE.sm }}>
              {/* Voice arrives with ser-p02-02; the entry is shown, not live. */}
              <Button label={AI_PAGE.startVoice} hint={AI_PAGE.voiceSoon} disabled />
              <AppText variant="footnote" color="textSecondary" align="center">
                {AI_PAGE.voiceSoon}
              </AppText>
            </View>
          ) : (
            <AppText variant="subhead" color="textSecondary" align="center">
              {AI_PAGE.searching}
            </AppText>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
