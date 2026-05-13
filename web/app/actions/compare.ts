"use server";

import {
  pollAnalyticalLensesTask,
  pollFindAllArticlesSnapshot,
  startAnalyticalLensesTask,
  startFindAllArticlesForThinker,
} from "@/lib/parallel-compare";
import { searchNewsForThinker } from "@/lib/parallel-news";

export async function compareLensesStartAction(thinkerName: string) {
  return startAnalyticalLensesTask(thinkerName);
}

export async function compareLensesPollAction(runId: string) {
  return pollAnalyticalLensesTask(runId);
}

export async function compareStartFindAllAction(thinkerName: string) {
  return startFindAllArticlesForThinker(thinkerName);
}

export async function comparePollFindAllAction(findallId: string) {
  return pollFindAllArticlesSnapshot(findallId);
}

export async function compareSearchAction(thinkerName: string) {
  const t = thinkerName.trim();
  if (!t) {
    return {
      ok: false as const,
      error: "Missing thinker name",
      articles: [],
      operations: [],
      sessionId: null,
      searchId: null,
      compareDebug: { requests: [] as { phase: "primary" | "retry"; body: Record<string, unknown> }[] },
    };
  }
  try {
    const res = await searchNewsForThinker({
      thinkerName: t,
      maxArticles: 5,
      includeCompareDebug: true,
    });
    return {
      ok: true as const,
      articles: res.articles,
      operations: res.operations,
      sessionId: res.sessionId,
      searchId: res.searchId,
      compareDebug: res.compareDebug ?? { requests: [] },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Search failed";
    return {
      ok: false as const,
      error: msg,
      articles: [],
      operations: [],
      sessionId: null,
      searchId: null,
      compareDebug: { requests: [] as { phase: "primary" | "retry"; body: Record<string, unknown> }[] },
    };
  }
}
