"use server";

import type { LensSlug } from "@/lib/lenses";
import { extractArticleExcerpt, searchNewsForThinker } from "@/lib/parallel-news";

export async function loadThinkerNewsAction(input: {
  thinkerName: string;
  excludeUrls?: string[];
  refreshNonce?: string;
}) {
  return searchNewsForThinker({
    thinkerName: input.thinkerName,
    excludeUrls: input.excludeUrls,
    refreshNonce: input.refreshNonce,
    maxArticles: 5,
  });
}

export async function searchMoreNewsAction(input: {
  thinkerName: string;
  refinement: string;
  excludeUrls?: string[];
  maxArticles?: number;
}) {
  return searchNewsForThinker({
    thinkerName: input.thinkerName,
    refinement: input.refinement,
    excludeUrls: input.excludeUrls,
    maxArticles: input.maxArticles ?? 10,
    primarySearchLabel: `Parallel Search: more articles for ${input.thinkerName.trim()} (“${input.refinement.trim()}”)`,
  });
}

export async function extractArticleAction(input: {
  url: string;
  thinkerName: string;
  lensSlug: LensSlug;
  sessionId?: string | null;
}) {
  return extractArticleExcerpt({
    url: input.url,
    thinkerName: input.thinkerName,
    lensSlug: input.lensSlug,
    sessionId: input.sessionId,
  });
}
