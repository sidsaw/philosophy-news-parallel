"use client";

import { useCallback, useMemo, useState } from "react";
import { extractArticleAction, loadThinkerNewsAction, searchMoreNewsAction } from "@/app/actions/news";
import { lensLabel } from "@/lib/lenses";
import type { NewsArticle } from "@/lib/parallel-news";
import { SUGGESTED_THINKERS } from "@/lib/suggested-thinkers";
import type { ParallelOperation } from "@/lib/types";

function mergeOpLog(prev: ParallelOperation[], incoming: ParallelOperation[], cap = 30): ParallelOperation[] {
  const map = new Map<string, ParallelOperation>();
  for (const o of prev) map.set(o.id, o);
  for (const o of incoming) map.set(o.id, o);
  return Array.from(map.values()).slice(-cap);
}

function formatOpStatus(op: ParallelOperation): string {
  if (op.status === "running") return "running";
  if (op.status === "error") return "error";
  return "done";
}

export function HomeApp() {
  const [query, setQuery] = useState("");
  const [thinker, setThinker] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [moreArticles, setMoreArticles] = useState<NewsArticle[]>([]);
  const [moreQuery, setMoreQuery] = useState("");
  const [opLog, setOpLog] = useState<ParallelOperation[]>([]);
  const [mainLoading, setMainLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const [modal, setModal] = useState<{
    article: NewsArticle;
    excerpt: string;
    title: string | null;
    loading: boolean;
  } | null>(null);

  const appendOps = useCallback((incoming: ParallelOperation[]) => {
    setOpLog((prev) => mergeOpLog(prev, incoming));
  }, []);

  const runLoad = useCallback(
    async (name: string, opts?: { excludeUrls?: string[]; refreshNonce?: string }) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setBannerError(null);
      setMainLoading(true);
      setThinker(trimmed);
      setArticles([]);
      setMoreArticles([]);
      setMoreQuery("");
      const pending: ParallelOperation = {
        id: `client-pending-search-${Date.now()}`,
        kind: "search",
        label: `Parallel Search: recent news on ${trimmed}`,
        status: "running",
      };
      setOpLog((prev) => mergeOpLog(prev, [pending]));
      try {
        const res = await loadThinkerNewsAction({
          thinkerName: trimmed,
          excludeUrls: opts?.excludeUrls,
          refreshNonce: opts?.refreshNonce,
        });
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-"));
          return mergeOpLog(withoutPending, res.operations);
        });
        setArticles(res.articles);
        setSessionId(res.sessionId);
        if (res.articles.length === 0) {
          setBannerError("No articles matched the filters (2026, reputable domains). Try refresh or a different spelling.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        setBannerError(msg);
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-"));
          return mergeOpLog(withoutPending, [
            {
              id: `client-err-${Date.now()}`,
              kind: "search",
              label: `Parallel Search: recent news on ${trimmed}`,
              status: "error",
              detail: msg,
            },
          ]);
        });
      } finally {
        setMainLoading(false);
      }
    },
    [],
  );

  const onSubmitSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await runLoad(query);
    },
    [query, runLoad],
  );

  const onPickSuggested = useCallback(
    (name: string) => {
      setQuery(name);
      void runLoad(name);
    },
    [runLoad],
  );

  const onRefresh = useCallback(async () => {
    if (!thinker) return;
    const exclude = articles.map((a) => a.url);
    await runLoad(thinker, {
      excludeUrls: exclude,
      refreshNonce: crypto.randomUUID().slice(0, 8),
    });
  }, [articles, thinker, runLoad]);

  const onSearchMore = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!thinker || !moreQuery.trim()) return;
      setMoreLoading(true);
      setBannerError(null);
      const pending: ParallelOperation = {
        id: `client-pending-more-${Date.now()}`,
        kind: "search",
        label: `Parallel Search: more articles for ${thinker} (“${moreQuery.trim()}”)`,
        status: "running",
      };
      setOpLog((prev) => mergeOpLog(prev, [pending]));
      try {
        const exclude = [...articles, ...moreArticles].map((a) => a.url);
        const res = await searchMoreNewsAction({
          thinkerName: thinker,
          refinement: moreQuery.trim(),
          excludeUrls: exclude,
          maxArticles: 10,
        });
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-more-"));
          return mergeOpLog(withoutPending, res.operations);
        });
        const existing = new Set([...articles, ...moreArticles].map((a) => a.url));
        const next = res.articles.filter((a) => !existing.has(a.url));
        setMoreArticles((prev) => [...prev, ...next]);
        if (next.length === 0) {
          setBannerError("No additional articles found for that search.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Request failed";
        setBannerError(msg);
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-more-"));
          return mergeOpLog(withoutPending, [
            {
              id: `client-err-more-${Date.now()}`,
              kind: "search",
              label: `Parallel Search: more articles`,
              status: "error",
              detail: msg,
            },
          ]);
        });
      } finally {
        setMoreLoading(false);
      }
    },
    [articles, moreArticles, moreQuery, thinker],
  );

  const openArticle = useCallback(
    async (article: NewsArticle) => {
      if (!thinker) return;
      setModal({ article, excerpt: "", title: null, loading: true });
      const pending: ParallelOperation = {
        id: `client-pending-extract-${Date.now()}`,
        kind: "extract",
        label: `Parallel Extract: ${article.url}`,
        status: "running",
      };
      setOpLog((prev) => mergeOpLog(prev, [pending]));
      try {
        const res = await extractArticleAction({
          url: article.url,
          thinkerName: thinker,
          lensSlug: article.lensSlug,
          sessionId,
        });
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-extract-"));
          return mergeOpLog(withoutPending, res.operations);
        });
        setModal({
          article,
          excerpt: res.excerptMarkdown || "No excerpt returned.",
          title: res.title,
          loading: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Extract failed";
        setOpLog((prev) => {
          const withoutPending = prev.filter((o) => !o.id.startsWith("client-pending-extract-"));
          return mergeOpLog(withoutPending, [
            {
              id: `client-err-extract-${Date.now()}`,
              kind: "extract",
              label: `Parallel Extract: ${article.url}`,
              status: "error",
              detail: msg,
            },
          ]);
        });
        setModal({
          article,
          excerpt: msg,
          title: null,
          loading: false,
        });
      }
    },
    [sessionId, thinker],
  );

  const sortedOps = useMemo(() => {
    return [...opLog].reverse();
  }, [opLog]);

  return (
    <div className="shell">
      <div className="topRow">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: "0 0 0.35rem", fontSize: "2rem" }}>Philosophy news</h1>
          <p className="muted" style={{ margin: 0 }}>
            Pick or search for a thinker. Results use Parallel Search (news from 2026, major outlets) and Parallel Extract when you open a story.
          </p>
        </div>
        {thinker ? (
          <button type="button" className="refreshBtn" onClick={() => void onRefresh()} disabled={mainLoading} title="Fetch five new articles">
            <span aria-hidden>↻</span>
            {mainLoading ? "Loading…" : "Refresh"}
          </button>
        ) : null}
      </div>

      <form className="searchBar" onSubmit={onSubmitSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a philosopher or public intellectual…"
          aria-label="Thinker search"
        />
        <button type="submit" disabled={mainLoading || !query.trim()}>
          {mainLoading ? "Loading…" : "Search"}
        </button>
      </form>

      <div className="chips" aria-label="Suggested names">
        {SUGGESTED_THINKERS.map((name) => (
          <button key={name} type="button" className="chip" onClick={() => onPickSuggested(name)} disabled={mainLoading}>
            {name}
          </button>
        ))}
      </div>

      {bannerError ? <div className="errorBanner">{bannerError}</div> : null}

      {thinker ? (
        <>
          <section className="opLog" aria-live="polite">
            <h2>Parallel API activity</h2>
            {sortedOps.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No calls yet.
              </p>
            ) : (
              sortedOps.map((op) => (
                <div key={op.id} className="opRow">
                  <span className={`opStatus ${op.status}`}>{formatOpStatus(op)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{op.label}</div>
                    {op.detail ? (
                      <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}>
                        {op.detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </section>

          <h2 className="sectionTitle">Recent coverage — {thinker}</h2>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
            Five options from Parallel Search (2026, reputable news domains).
          </p>
          <div className="cards">
            {articles.map((a) => (
              <button key={a.url} type="button" className="card" onClick={() => void openArticle(a)}>
                <div className="cardMeta">
                  <span className="lensTag">{lensLabel(a.lensSlug)}</span>
                  {a.source}
                  {a.publishDate ? ` · ${a.publishDate}` : ""}
                </div>
                <div className="cardTitle">{a.title}</div>
                {a.snippet ? (
                  <p className="snippet">{a.snippet}</p>
                ) : null}
              </button>
            ))}
          </div>

          <section className="moreBlock">
            <h2 className="sectionTitle">Find more articles</h2>
            <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "0.75rem" }}>
              Run another Parallel Search on this page with your own keywords (append to the same session where possible).
            </p>
            <form className="searchBar" onSubmit={onSearchMore}>
              <input
                value={moreQuery}
                onChange={(e) => setMoreQuery(e.target.value)}
                placeholder="e.g. university appointment, new book, controversy…"
                aria-label="Keywords for more articles"
              />
              <button type="submit" disabled={moreLoading || !moreQuery.trim()}>
                {moreLoading ? "Searching…" : "Search"}
              </button>
            </form>
            {moreArticles.length > 0 ? (
              <>
                <h3 style={{ fontFamily: "inherit", fontSize: "1rem", margin: "1.25rem 0 0.5rem" }}>More results</h3>
                <div className="cards">
                  {moreArticles.map((a) => (
                    <button key={a.url} type="button" className="card" onClick={() => void openArticle(a)}>
                      <div className="cardMeta">
                        <span className="lensTag">{lensLabel(a.lensSlug)}</span>
                        {a.source}
                        {a.publishDate ? ` · ${a.publishDate}` : ""}
                      </div>
                      <div className="cardTitle">{a.title}</div>
                      {a.snippet ? <p className="snippet">{a.snippet}</p> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {modal ? (
        <div
          className="backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="article-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="modal">
            <h2 id="article-modal-title">{modal.title ?? modal.article.title}</h2>
            <p className="muted" style={{ margin: "0.25rem 0 1rem" }}>
              <span className="lensTag">{lensLabel(modal.article.lensSlug)}</span>
              {modal.article.source}
            </p>
            {modal.loading ? <p className="muted">Calling Parallel Extract…</p> : <div className="excerptBody">{modal.excerpt}</div>}
            <div className="modalActions">
              <a className="primary" href={modal.article.url} target="_blank" rel="noopener noreferrer">
                Open original article
              </a>
              <button type="button" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
