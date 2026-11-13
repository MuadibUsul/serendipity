import { RADIUS, SPACE } from "@serendipity/ui";
import { View } from "react-native";

import type { Home, UpcomingDate } from "../api/types";
import { DATES_PAGE } from "../copy";
import { dateParts, daysUntil, formatMoney } from "../format";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Illustration } from "../ui/Illustration";
import { EmptyState, Screen } from "../ui/Screen";
import { useMaterials, usePalette } from "../ui/theme";

/**
 * The invitation: a raised glass card with the time large and quiet, the
 * place, what this person pays and how to cancel. A gentle "days to go",
 * never a ticking clock. Nothing about the other person (PRD-001 §5.3, §6.1).
 */
function Invitation({ date, now }: { readonly date: UpcomingDate; readonly now: Date }) {
  const palette = usePalette();
  const materials = useMaterials();
  const { day, time } = dateParts(date.startsAt, date.timeZone);
  const days = daysUntil(date.startsAt, date.timeZone, now);
  return (
    <Glass raised radius={RADIUS.xl} style={{ padding: SPACE.xxl, gap: SPACE.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          <View
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent }}
          />
          <AppText variant="footnote" color="textSecondary">
            {DATES_PAGE.yourDate}
          </AppText>
        </View>
        <View
          style={{
            backgroundColor: materials.fill,
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
        <AppText variant="title">{day}</AppText>
        <AppText variant="numeral">{time}</AppText>
      </View>
      <View
        accessible
        aria-label={`${DATES_PAGE.where}：${date.venueName}，${date.venueAddress}`}
        style={{ gap: SPACE.xs }}
      >
        <AppText variant="headline">{date.venueName}</AppText>
        <AppText variant="subhead" color="textSecondary">
          {date.venueAddress}
        </AppText>
      </View>
      <View style={{ height: 1, backgroundColor: materials.separator }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.xl }}>
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
          aria-label={`${DATES_PAGE.yourShare}：${formatMoney(date.amountMinor, date.currency)}`}
          style={{ gap: SPACE.xs }}
        >
          <AppText variant="footnote" color="textSecondary">
            {DATES_PAGE.yourShare}
          </AppText>
          <AppText variant="label">{formatMoney(date.amountMinor, date.currency)}</AppText>
        </View>
      </View>
      <View
        accessible
        aria-label={`${DATES_PAGE.cancelRule}：${date.cancelRule}`}
        style={{ gap: SPACE.xs }}
      >
        <AppText variant="footnote" color="textSecondary">
          {DATES_PAGE.cancelRule}
        </AppText>
        <AppText variant="subhead">{date.cancelRule}</AppText>
      </View>
    </Glass>
  );
}

export function DatesScreen({ home, now }: { readonly home: Home; readonly now: Date }) {
  const date = home.upcoming;
  return (
    <Screen title={DATES_PAGE.title}>
      {date === null ? (
        <EmptyState
          art={<Illustration name="cups" />}
          line={DATES_PAGE.empty}
          hint={DATES_PAGE.emptyHint}
        />
      ) : (
        <>
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
