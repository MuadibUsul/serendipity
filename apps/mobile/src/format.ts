// Formatting for display. Amounts are integers in minor units (CONTRIBUTING.md).

const SYMBOLS: Readonly<Record<string, string>> = { CNY: "¥" };

export function formatMoney(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(2);
  const symbol = SYMBOLS[currency];
  return symbol === undefined ? `${major} ${currency}` : `${symbol}${major}`;
}

/** A UTC instant shown as local date and time in `timeZone`, in Chinese. */
export function formatDateTime(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoUtc));
}
