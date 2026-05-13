import { classifyLensFromText } from "./classify-lens";
import type { LensSlug } from "./lenses";
import { lensLabel } from "./lenses";
import { getParallelClient } from "./parallel-client";
import { REPUTABLE_NEWS_DOMAINS } from "./reputable-domains";
import type { ParallelOperation } from "./types";

export type NewsArticle = {
  url: string;
  title: string;
  source: string;
  publishDate: string | null;
  snippet: string;
  lensSlug: LensSlug;
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildSearchQueries(thinker: string, refinement?: string) {
  const t = thinker.trim();
  const base = [
    `${t} philosophy news 2026`,
    `${t} philosopher interview book 2026`,
  ];
  if (refinement?.trim()) {
    base.push(`${t} ${refinement.trim()} 2026`);
  } else {
    base.push(`${t} ethics political philosophy 2026`);
  }
  return base;
}

export type SearchCompareRequestLog = {
  phase: "primary" | "retry";
  body: Record<string, unknown>;
};

export async function searchNewsForThinker(params: {
  thinkerName: string;
  refinement?: string;
  excludeUrls?: string[];
  refreshNonce?: string;
  maxArticles?: number;
  /** Overrides the default first operation label for UI logs */
  primarySearchLabel?: string;
  /** When true, echoes each `client.search` payload for compare / debug UI */
  includeCompareDebug?: boolean;
}): Promise<{
  articles: NewsArticle[];
  operations: ParallelOperation[];
  sessionId: string | null;
  searchId: string | null;
  compareDebug?: { requests: SearchCompareRequestLog[] };
}> {
  const maxArticles = params.maxArticles ?? 5;
  const ops: ParallelOperation[] = [];
  const searchOpId = crypto.randomUUID();
  ops.push({
    id: searchOpId,
    kind: "search",
    label:
      params.primarySearchLabel ??
      `Parallel Search: recent news on ${params.thinkerName.trim()}`,
    status: "running",
  });

  const queries = buildSearchQueries(params.thinkerName, params.refinement);
  const exclude = (params.excludeUrls ?? []).filter(Boolean);
  const exclusionNote =
    exclude.length > 0
      ? ` Do not return these URLs again: ${exclude.slice(0, 30).join(" ")}`
      : "";
  const refreshNote = params.refreshNonce
    ? ` Prioritize different stories than prior results (refresh ${params.refreshNonce}).`
    : "";

  const objective = [
    `Find up to ${maxArticles} distinct news articles from 2026 that discuss the philosopher or public intellectual "${params.thinkerName.trim()}" or their ideas in mainstream reporting.`,
    "Prefer reporting, analysis, interviews, or book coverage—not forums or social posts.",
    `${exclusionNote}${refreshNote}`,
  ].join("");

  const includeDomains = [...REPUTABLE_NEWS_DOMAINS];
  const compareRequests: SearchCompareRequestLog[] = [];

  let client;
  try {
    client = getParallelClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parallel client unavailable";
    ops[0] = { ...ops[0], status: "error", detail: msg };
    return {
      articles: [],
      operations: ops,
      sessionId: null,
      searchId: null,
      ...(params.includeCompareDebug ? { compareDebug: { requests: compareRequests } } : {}),
    };
  }

  const runSearch = async (broaden: boolean) => {
    const searchBody = {
      objective: broaden
        ? `${objective} If needed, include closely adjacent stories still clearly tied to this figure.`
        : objective,
      search_queries: queries,
      mode: "basic" as const,
      advanced_settings: {
        max_results: Math.min(25, Math.max(maxArticles * 3, 12)),
        source_policy: {
          include_domains: includeDomains,
          after_date: "2026-01-01",
        },
      },
    };
    if (params.includeCompareDebug) {
      compareRequests.push({
        phase: broaden ? "retry" : "primary",
        body: searchBody as unknown as Record<string, unknown>,
      });
    }
    return client.search(searchBody);
  };

  let response;
  try {
    response = await runSearch(false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Search failed";
    ops[0] = { ...ops[0], status: "error", detail: msg };
    return {
      articles: [],
      operations: ops,
      sessionId: null,
      searchId: null,
      ...(params.includeCompareDebug ? { compareDebug: { requests: compareRequests } } : {}),
    };
  }

  ops[0] = {
    ...ops[0],
    status: "completed",
    detail: `search_id: ${response.search_id}`,
  };

  const mapped: NewsArticle[] = [];
  const excluded = new Set(exclude.map((u) => u.toLowerCase()));

  const pushResults = (
    results: {
      url: string;
      title?: string | null;
      publish_date?: string | null;
      excerpts: string[];
    }[],
  ) => {
    for (const r of results) {
      if (mapped.length >= maxArticles) break;
      const url = r.url;
      if (!url || excluded.has(url.toLowerCase())) continue;
      if (mapped.some((m) => m.url === url)) continue;
      const host = hostname(url);
      if (!host) continue;
      const textBlob = [r.title, ...(r.excerpts ?? [])].filter(Boolean).join("\n");
      const lensSlug = classifyLensFromText(textBlob);
      mapped.push({
        url,
        title: r.title ?? host,
        source: host,
        publishDate: r.publish_date ?? null,
        snippet: (r.excerpts?.[0] ?? "").slice(0, 420),
        lensSlug,
      });
    }
  };

  pushResults(response.results ?? []);

  if (mapped.length < maxArticles) {
    const retryOpId = crypto.randomUUID();
    ops.push({
      id: retryOpId,
      kind: "search",
      label: `Parallel Search (retry): broaden for ${params.thinkerName.trim()}`,
      status: "running",
    });
    try {
      const retry = await runSearch(true);
      ops[ops.length - 1] = {
        ...ops[ops.length - 1],
        status: "completed",
        detail: `search_id: ${retry.search_id}`,
      };
      pushResults(retry.results ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed";
      ops[ops.length - 1] = {
        ...ops[ops.length - 1],
        status: "error",
        detail: msg,
      };
    }
  }

  return {
    articles: mapped,
    operations: ops,
    sessionId: response.session_id ?? null,
    searchId: response.search_id ?? null,
    ...(params.includeCompareDebug ? { compareDebug: { requests: compareRequests } } : {}),
  };
}

export async function extractArticleExcerpt(params: {
  url: string;
  thinkerName: string;
  lensSlug: LensSlug;
  sessionId?: string | null;
}): Promise<{
  excerptMarkdown: string;
  title: string | null;
  operations: ParallelOperation[];
}> {
  const ops: ParallelOperation[] = [];
  const id = crypto.randomUUID();
  ops.push({
    id,
    kind: "extract",
    label: `Parallel Extract: ${params.url}`,
    status: "running",
  });
  const lens = lensLabel(params.lensSlug);
  const objective = `Summarize this news article in clear markdown. Ground every claim in the page. Explain how it connects to ${params.thinkerName.trim()} and the philosophical lens “${lens}”.`;

  try {
    const client = getParallelClient();
    const res = await client.extract({
      urls: [params.url],
      objective,
      session_id: params.sessionId ?? undefined,
      advanced_settings: {
        excerpt_settings: { max_chars_per_result: 6000 },
      },
    });
    const first = res.results[0];
    const excerpts = first?.excerpts?.length ? first.excerpts.join("\n\n") : "";
    const err = res.errors?.find((e) => e.url === params.url);
    if (err) {
      ops[0] = {
        ...ops[0],
        status: "error",
        detail: err.content ?? err.error_type,
      };
      return { excerptMarkdown: "", title: null, operations: ops };
    }
    ops[0] = {
      ...ops[0],
      status: "completed",
      detail: `extract_id: ${res.extract_id}`,
    };
    return {
      excerptMarkdown: excerpts,
      title: first?.title ?? null,
      operations: ops,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extract failed";
    ops[0] = { ...ops[0], status: "error", detail: msg };
    return { excerptMarkdown: "", title: null, operations: ops };
  }
}
