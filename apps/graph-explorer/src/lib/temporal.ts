import type { GraphLink } from './graphBuilder';

export function filterLinksByAsOf(links: GraphLink[], asOf: string): GraphLink[] {
  const t = new Date(asOf).getTime();
  if (isNaN(t)) return links;

  return links.filter(l => {
    if (l.validFrom) {
      const from = new Date(l.validFrom).getTime();
      if (from > t) return false;
    }
    if (l.validUntil) {
      const until = new Date(l.validUntil).getTime();
      if (until <= t) return false;
    }
    return true;
  });
}
