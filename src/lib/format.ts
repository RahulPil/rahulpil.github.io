export function formatDate(d: Date, opts: { short?: boolean } = {}): string {
  if (opts.short) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function isoMonth(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function byDateDesc<T extends { data: { date: Date } }>(a: T, b: T) {
  return b.data.date.getTime() - a.data.date.getTime();
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  return items.reduce((acc, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}
