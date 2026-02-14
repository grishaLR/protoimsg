export function hasMentionOf(facets: unknown[] | undefined, targetDid: string): boolean {
  if (!facets) return false;
  return facets.some((facet) => {
    const f = facet as { features?: Array<{ $type?: string; did?: string }> };
    return f.features?.some(
      (feat) =>
        (feat.$type === 'app.protoimsg.chat.message#mention' ||
          feat.$type === 'app.bsky.richtext.facet#mention') &&
        feat.did === targetDid,
    );
  });
}
