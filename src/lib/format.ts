const numberFormat = new Intl.NumberFormat("en-US");

export function formatCount(n: number, singular: string, plural = `${singular}s`) {
  return `${numberFormat.format(n)} ${n === 1 ? singular : plural}`;
}

export function formatNumber(n: number) {
  return numberFormat.format(n);
}

export function formatWords(n: number) {
  return formatCount(n, "word");
}

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(d: Date | string) {
  return dateTime.format(new Date(d));
}
