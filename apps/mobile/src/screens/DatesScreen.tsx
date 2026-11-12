import type { Home } from "../api/types";
import { DATES_PAGE } from "../copy";
import { formatDateTime, formatMoney } from "../format";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Field, Screen } from "../ui/Screen";

/**
 * The person's own date: when, where, what they pay, how to cancel, where to
 * get help. Nothing about the other person (PRD-001 §5.3, §6.1).
 */
export function DatesScreen({ home }: { readonly home: Home }) {
  const date = home.upcoming;
  return (
    <Screen>
      <AppText variant="title" heading>
        {DATES_PAGE.title}
      </AppText>
      {date === null ? (
        <Card>
          <AppText>{DATES_PAGE.empty}</AppText>
          <AppText color="textMuted">{DATES_PAGE.emptyHint}</AppText>
        </Card>
      ) : (
        <Card>
          <Field label={DATES_PAGE.when} value={formatDateTime(date.startsAt, date.timeZone)} />
          <Field label={DATES_PAGE.where} value={`${date.venueName}，${date.venueAddress}`} />
          <Field label={DATES_PAGE.pkg} value={date.packageName} />
          <Field
            label={DATES_PAGE.yourShare}
            value={formatMoney(date.amountMinor, date.currency)}
          />
          <Field label={DATES_PAGE.cancelRule} value={date.cancelRule} />
          <AppText variant="caption" color="textMuted">
            {DATES_PAGE.hidden}
          </AppText>
          {/* The help desk arrives with ser-p04-10; shown, not live yet. */}
          <Button label={DATES_PAGE.help} variant="secondary" disabled />
        </Card>
      )}
    </Screen>
  );
}
