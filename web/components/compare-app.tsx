"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareLensesAction,
  comparePollFindAllAction,
  compareSearchAction,
  compareStartFindAllAction,
} from "@/app/actions/compare";
import type { AnalyticalLens } from "@/lib/parallel-compare";
import { lensLabel } from "@/lib/lenses";
import type { NewsArticle } from "@/lib/parallel-news";
import { SUGGESTED_THINKERS } from "@/lib/suggested-thinkers";

function CodePanel({ title, code }: { title: string; code: string }) {
  return (
    <div className="codePanel">
      <div className="codePanelTitle">{title}</div>
      <pre className="codePanelPre">
        <code>{code.trim() ? code : "…"}</code>
      </pre>
    </div>
  );
}

function ArticleLinks({ articles }: { articles: NewsArticle[] }) {
  if (articles.length === 0) {
    return (
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        No article links yet.
      </p>
    );
  }
  return (
    <ul className="articleLinkList">
      {articles.map((a) => (
        <li key={a.url}>
          <a href={a.url} target="_blank" rel="noopener noreferrer">
            {a.title}
          </a>
          <span className="muted"> — {a.source}</span>
          {a.publishDate ? <span className="muted"> · {a.publishDate}</span> : null}
        </li>
      ))}
    </ul>
  );
}

type LensesUi = {
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  apiCallSnippet: string;
  resultSnippet: string;
  lenses: AnalyticalLens[];
};

type FindAllUi = {
  status: "idle" | "starting" | "polling" | "done" | "error";
  error?: string;
  ingestSnippet: string;
  createSnippet: string;
  findallId: string | null;
  lastPollSnippet: string;
  lastResultJson: string;
  runStatus?: string;
  metricsText?: string;
  articles: NewsArticle[];
};

type SearchUi = {
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  articles: NewsArticle[];
  requestSnippets: { phase: string; json: string }[];
  resultSnippet: string;
  sessionId: string | null;
  searchId: string | null;
};

const initialLenses: LensesUi = {
  status: "idle",
  apiCallSnippet: "",
  resultSnippet: "",
  lenses: [],
};

const initialFindAll: FindAllUi = {
  status: "idle",
  ingestSnippet: "",
  createSnippet: "",
  findallId: null,
  lastPollSnippet: "",
  lastResultJson: "",
  articles: [],
};

const initialSearch: SearchUi = {
  status: "idle",
  articles: [],
  requestSnippets: [],
  resultSnippet: "",
  sessionId: null,
  searchId: null,
};

export function CompareApp() {
  const [query, setQuery] = useState("");
  const [lenses, setLenses] = useState<LensesUi>(initialLenses);
  const [findAll, setFindAll] = useState<FindAllUi>(initialFindAll);
  const [search, setSearch] = useState<SearchUi>(initialSearch);
  const [findallId, setFindallId] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!findallId) return;

    clearPoll();
    pollStartRef.current = Date.now();

    const applyPoll = (p: Awaited<ReturnType<typeof comparePollFindAllAction>>) => {
      if (!p.ok) {
        setFindAll((prev) => ({
          ...prev,
          error: p.error,
          status: "error",
          lastPollSnippet: p.pollSnippet,
          lastResultJson: p.resultJson,
          articles: p.articles,
        }));
        clearPoll();
        return;
      }

      const metricsText =
        p.metrics != null
          ? `matched: ${p.metrics.matched ?? "—"}, generated: ${p.metrics.generated ?? "—"}`
          : undefined;
      const terminal = !p.active || p.runStatus === "failed" || p.runStatus === "cancelled";
      const timedOut = Date.now() - pollStartRef.current > 480_000;

      setFindAll((prev) => ({
        ...prev,
        lastPollSnippet: p.pollSnippet,
        lastResultJson: p.resultJson,
        articles: p.articles,
        runStatus: p.runStatus,
        metricsText,
        error: undefined,
        status: terminal || timedOut ? "done" : "polling",
      }));

      if (terminal || timedOut) {
        clearPoll();
      }
    };

    void (async () => {
      const first = await comparePollFindAllAction(findallId);
      applyPoll(first);
    })();

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        const p = await comparePollFindAllAction(findallId);
        applyPoll(p);
      })();
    }, 3500);

    return () => {
      clearPoll();
    };
  }, [findallId, clearPoll]);

  const runCompare = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    clearPoll();
    setFindallId(null);
    setLenses({ ...initialLenses, status: "loading" });
    setFindAll({ ...initialFindAll, status: "starting" });
    setSearch({ ...initialSearch, status: "loading" });

    void (async () => {
      const r = await compareLensesAction(trimmed);
      setLenses({
        status: r.ok ? "done" : "error",
        error: r.error,
        apiCallSnippet: r.apiCallSnippet,
        resultSnippet: r.resultSnippet,
        lenses: r.lenses,
      });
    })();

    void (async () => {
      const r = await compareStartFindAllAction(trimmed);
      if (!r.ok) {
        setFindAll((prev) => ({
          ...prev,
          status: "error",
          error: r.error ?? "FindAll failed to start",
          ingestSnippet: r.ingestSnippet,
          createSnippet: r.createSnippet,
        }));
        return;
      }
      const id = r.findallId;
      setFindAll((prev) => ({
        ...prev,
        status: "polling",
        ingestSnippet: r.ingestSnippet,
        createSnippet: r.createSnippet,
        findallId: id,
      }));
      setFindallId(id);
    })();

    void (async () => {
      const r = await compareSearchAction(trimmed);
      if (!r.ok) {
        setSearch({
          status: "error",
          error: r.error,
          articles: [],
          requestSnippets: [],
          resultSnippet: "",
          sessionId: null,
          searchId: null,
        });
        return;
      }
      const requestSnippets = r.compareDebug.requests.map((req) => ({
        phase: req.phase,
        json: JSON.stringify(req.body, null, 2),
      }));
      const resultSnippet = JSON.stringify(
        {
          search_id: r.searchId,
          session_id: r.sessionId,
          article_count: r.articles.length,
          articles: r.articles.map((a) => ({
            title: a.title,
            url: a.url,
            source: a.source,
            publish_date: a.publishDate,
            lens: lensLabel(a.lensSlug),
          })),
        },
        null,
        2,
      );
      setSearch({
        status: "done",
        articles: r.articles,
        requestSnippets,
        resultSnippet,
        sessionId: r.sessionId,
        searchId: r.searchId,
      });
    })();
  }, [clearPoll]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await runCompare(query);
    },
    [query, runCompare],
  );

  const onPick = useCallback(
    (name: string) => {
      setQuery(name);
      void runCompare(name);
    },
    [runCompare],
  );

  const lensesStatus =
    lenses.status === "loading" ? "Running…" : lenses.status === "error" ? "Error" : lenses.status === "done" ? "Done" : "Idle";

  const findAllStatusLabel =
    findAll.status === "starting"
      ? "Starting run…"
      : findAll.status === "polling"
        ? "Polling FindAll…"
        : findAll.status === "done"
          ? "Run finished"
          : findAll.status === "error"
            ? "Error"
            : "Idle";

  const searchStatus =
    search.status === "loading" ? "Running…" : search.status === "error" ? "Error" : search.status === "done" ? "Done" : "Idle";

  return (
    <div className="shell comparePage">
      <p className="muted" style={{ margin: "0 0 1rem" }}>
        <a href="/">← Philosophy news home</a>
      </p>

      <div className="topRow">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.85rem" }}>Parallel API compare</h1>
          <p className="muted" style={{ margin: 0 }}>
            Task API proposes three analytical lenses. FindAll (left) and Search (right) each fetch up to five 2026 articles.
            Snippets show representative requests and JSON snapshots; links update as responses arrive.
          </p>
        </div>
      </div>

      <form className="searchBar" onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Philosopher or public intellectual…"
          aria-label="Thinker name"
        />
        <button type="submit" disabled={!query.trim()}>
          Run compare
        </button>
      </form>

      <div className="chips" aria-label="Suggested names">
        {SUGGESTED_THINKERS.map((name) => (
          <button key={name} type="button" className="chip" onClick={() => onPick(name)}>
            {name}
          </button>
        ))}
      </div>

      <section className="compareTop">
        <h2 className="compareColTitle">1. Task API — three analytical lenses</h2>
        <p className="muted" style={{ marginTop: "-0.35rem" }}>
          Status: <strong>{lensesStatus}</strong>
          {lenses.error ? (
            <>
              {" "}
              — <span className="errorInline">{lenses.error}</span>
            </>
          ) : null}
        </p>
        <CodePanel title="POST /v1/tasks/runs (body)" code={lenses.apiCallSnippet} />
        <CodePanel title="Task result snapshot" code={lenses.resultSnippet} />
        {lenses.lenses.length > 0 ? (
          <ol className="lensList">
            {lenses.lenses.map((l, i) => (
              <li key={`${l.title}-${i}`}>
                <strong>{l.title}</strong>
                <p className="muted" style={{ margin: "0.25rem 0 0.5rem", whiteSpace: "pre-wrap" }}>
                  {l.description}
                </p>
                {l.guiding_questions && l.guiding_questions.length > 0 ? (
                  <ul className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                    {l.guiding_questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : lenses.status === "done" ? (
          <p className="muted">No lenses parsed from the task output.</p>
        ) : null}
      </section>

      <div className="compareRow">
        <section className="compareCol">
          <h2 className="compareColTitle">2a. FindAll (beta)</h2>
          <p className="muted" style={{ marginTop: "-0.35rem" }}>
            {findAllStatusLabel}
            {findAll.runStatus ? (
              <>
                {" "}
                — run <code>{findAll.runStatus}</code>
              </>
            ) : null}
            {findAll.metricsText ? (
              <>
                {" "}
                — {findAll.metricsText}
              </>
            ) : null}
            {findAll.error ? (
              <>
                {" "}
                — <span className="errorInline">{findAll.error}</span>
              </>
            ) : null}
          </p>
          <CodePanel title="POST /v1beta/findall/ingest" code={findAll.ingestSnippet} />
          <CodePanel title="POST /v1beta/findall/runs" code={findAll.createSnippet} />
          <CodePanel title="GET /v1beta/findall/runs/{id} + /result (poll)" code={findAll.lastPollSnippet} />
          <CodePanel title="FindAll snapshot JSON" code={findAll.lastResultJson} />
          <h3 className="compareSubTitle">Articles (matched)</h3>
          <ArticleLinks articles={findAll.articles} />
        </section>

        <section className="compareCol">
          <h2 className="compareColTitle">2b. Search API</h2>
          <p className="muted" style={{ marginTop: "-0.35rem" }}>
            Status: <strong>{searchStatus}</strong>
            {search.error ? (
              <>
                {" "}
                — <span className="errorInline">{search.error}</span>
              </>
            ) : null}
          </p>
          {search.requestSnippets.map((req) => (
            <CodePanel key={req.phase} title={`Parallel.search (${req.phase})`} code={req.json} />
          ))}
          <CodePanel title="Search outcome (mapped articles)" code={search.resultSnippet} />
          <h3 className="compareSubTitle">Articles</h3>
          <ArticleLinks articles={search.articles} />
        </section>
      </div>
    </div>
  );
}
