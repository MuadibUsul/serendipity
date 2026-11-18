import { RADIUS, SPACE } from "@serendipity/ui";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import type { Home, UpcomingDate } from "../api/types";
import { DATES_PAGE } from "../copy";
import { dateParts, daysUntil, formatMoney } from "../format";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Illustration } from "../ui/Illustration";
import { EmptyState, Screen } from "../ui/Screen";
import { usePalette } from "../ui/theme";

/** A hairline that fades out at both ends. Decorative. */
function FadingRule() {
  return (
    <View aria-hidden style={{ height: 1, marginVertical: SPACE.sm }}>
      <Svg width="100%" height={1} preserveAspectRatio="none" viewBox="0 0 100 1">
        <Defs>
          <LinearGradient id="invitation-rule" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#141923" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#141923" stopOpacity={0.1} />
            <Stop offset="1" stopColor="#141923" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={100} height={1} fill="url(#invitation-rule)" />
      </Svg>
    </View>
  );
}

/** A small glowing coral dot before a status line. */
function GlowDot() {
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

/**
 * The invitation (the 柔光 design): a glass card floating in soft light over a
 * faint coral halo, the time large and light, the place, what this person
 * pays and how to cancel. A gentle "days to go", never a ticking clock.
 * Nothing about the other person (PRD-001 §5.3, §6.1).
 */
function Invitation({ date, now }: { readonly date: UpcomingDate; readonly now: Date }) {
  const { day, time } = dateParts(date.startsAt, date.timeZone);
  const days = daysUntil(date.startsAt, date.timeZone, now);
  const price = formatMoney(date.amountMinor, date.currency);
  return (
    <Glass halo radius={RADIUS.xl} style={{ padding: SPACE.xxl, gap: SPACE.xs }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: SPACE.xl,
        }}
      >
        <AppText variant="latin" color="textSecondary">
          {DATES_PAGE.cardLabel}
        </AppText>
        <View
          style={{
            backgroundColor: "rgba(255,107,129,0.1)",
            borderRadius: RADIUS.pill,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.xs,
          }}
        >
          <AppText variant="footnote" color="accentText">
            {DATES_PAGE.countdown(days)}
          </AppText>
        </View>
      </View>
      <View accessible aria-label={`${DATES_PAGE.when}：${day} ${time}`}>
        <AppText variant="subtitle">{day}</AppText>
        <AppText variant="numeral">{time}</AppText>
      </View>
      <View
        accessible
        aria-label={`${DATES_PAGE.where}：${date.venueName}，${date.venueAddress}`}
        style={{ gap: SPACE.xs, marginTop: SPACE.lg }}
      >
        <AppText variant="headline">{date.venueName}</AppText>
        <AppText variant="subhead" color="textSecondary">
          {date.venueAddress}
        </AppText>
      </View>
      <View style={{ marginVertical: SPACE.lg }}>
        <FadingRule />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.lg }}>
        <View
          accessible
          aria-label={`${DATES_PAGE.pkg}：${date.packageName}`}
          style={{ flexGrow: 1, gap: SPACE.xs }}
        >
          <AppText variant="footnote" color="textSecondary">
            {DATES_PAGE.pkg}
          </AppText>
          <AppText variant="label">{date.packageName}</AppText>
        </View>
        <View
          accessible
          aria-label={`${DATES_PAGE.yourShare}：${price}`}
          style={{ gap: SPACE.xs, alignItems: "flex-end" }}
        >
          <AppText variant="footnote" color="textSecondary">
            {DATES_PAGE.yourShare}
          </AppText>
          <AppText variant="amount">{price}</AppText>
        </View>
      </View>
      <View
        accessible
        aria-label={`${DATES_PAGE.cancelRule}：${date.cancelRule}`}
        style={{ marginTop: SPACE.md }}
      >
        <AppText variant="footnote" color="textSecondary">
          {date.cancelRule}
        </AppText>
      </View>
    </Glass>
  );
}

export function DatesScreen({ home, now }: { readonly home: Home; readonly now: Date }) {
  const date = home.upcoming;
  return (
    <Screen ambient={date === null ? "default" : "invite"}>
      {date === null ? (
        <EmptyState
          art={<Illustration name="cups" />}
          line={DATES_PAGE.empty}
          hint={DATES_PAGE.emptyHint}
        />
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
            <GlowDot />
            <AppText variant="subhead" color="textSecondary" heading>
              {DATES_PAGE.yourDate}
            </AppText>
          </View>
          <Invitation date={date} now={now} />
          <AppText variant="footnote" color="textSecondary" align="center">
            {DATES_PAGE.hidden}
          </AppText>
          {/* The help desk arrives with ser-p04-10; shown, not live yet. */}
          <Button label={DATES_PAGE.help} variant="secondary" disabled />
        </>
      )}
    </Screen>
  );
}
