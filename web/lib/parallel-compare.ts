import { classifyLensFromText } from "./classify-lens";
import type { NewsArticle } from "./parallel-news";
import { getParallelClient } from "./parallel-client";
import type { JsonSchema } from "parallel-web/resources/task-run.js";

export type AnalyticalLens = {
  title: string;
  description: string;
  guiding_questions?: string[];
};

const LENSES_OUTPUT_SCHEMA: JsonSchema = {
  type: "json",
  json_schema: {
    type: "object",
    required: ["lenses"],
    properties: {
      lenses: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "description"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            guiding_questions: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatHttpSnippet(method: string, path: string, body: unknown): string {
  return JSON.stringify({ method, path, body }, null, 2);
}

function normalizeLenses(raw: unknown): AnalyticalLens[] {
  if (!raw || typeof raw !== "object") return [];
  const lenses = (raw as { lenses?: unknown }).lenses;
  if (!Array.isArray(lenses)) return [];
  const out: AnalyticalLens[] = [];
  for (const item of lenses) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : "";
    const description = typeof o.description === "string" ? o.description : "";
    if (!title && !description) continue;
    const gq = Array.isArray(o.guiding_questions)
      ? o.guiding_questions.filter((x): x is string => typeof x === "string")
      : undefined;
    out.push({ title: title || "Lens", description, guiding_questions: gq });
  }
  return out.slice(0, 3);
}

function buildLensesTaskInput(thinkerName: string): string {
  const t = thinkerName.trim();
  return [
    `For the philosopher or public intellectual "${t}", define exactly three distinct analytical lenses`,
    "a thoughtful reader could use when scanning 2026 news about this figure.",
    "Each lens should have a short title, a paragraph description, and optional guiding questions.",
    "Lenses should be genuinely different (e.g. institutional role vs. ideas vs. public controversy), not rewordings of the same angle.",
    "Return JSON with a top-level \"lenses\" array containing exactly three objects (no more, no fewer), each with \"title\" and \"description\" strings, and optionally \"guiding_questions\" as an array of strings.",
  ].join(" ");
}

function buildLensesCreateBody(thinkerName: string) {
  return {
    input: buildLensesTaskInput(thinkerName),
    processor: "base",
    enable_events: true,
    task_spec: {
      output_schema: LENSES_OUTPUT_SCHEMA,
    },
  };
}

/** Fast: creates the task run only. Poll with {@link pollAnalyticalLensesTask}. */
export async function startAnalyticalLensesTask(thinkerName: string): Promise<
  | { ok: true; runId: string; apiCallSnippet: string }
  | { ok: false; error: string; apiCallSnippet: string }
> {
  const t = thinkerName.trim();
  if (!t) {
    return { ok: false, error: "Missing thinker name", apiCallSnippet: "" };
  }

  let client;
  try {
    client = getParallelClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parallel client unavailable";
    return { ok: false, error: msg, apiCallSnippet: "" };
  }

  const createBody = buildLensesCreateBody(t);
  const apiCallSnippet = formatHttpSnippet("POST", "/v1/tasks/runs", createBody);

  try {
    const run = await client.taskRun.create(createBody);
    return { ok: true, runId: run.run_id, apiCallSnippet };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Task create failed";
    return { ok: false, error: msg, apiCallSnippet };
  }
}

function parseTaskRunCompletedResult(result: {
  output: { type: string; content?: unknown };
  run: { run_id: string; status: string; error?: { message?: string | null } | null };
}): { ok: boolean; error?: string; resultSnippet: string; lenses: AnalyticalLens[] } {
  const out = result.output;
  let lenses: AnalyticalLens[] = [];
  let resultSnippet: string;

  if (out.type === "json" && out.content && typeof out.content === "object") {
    lenses = normalizeLenses(out.content);
    resultSnippet = JSON.stringify(
      { run_id: result.run.run_id, status: result.run.status, output: out.content },
      null,
      2,
    ).slice(0, 24000);
  } else if (out.type === "text" && typeof (out as { content?: unknown }).content === "string") {
    const text = (out as { content: string }).content;
    resultSnippet = JSON.stringify(
      { run_id: result.run.run_id, status: result.run.status, output_type: "text", text },
      null,
      2,
    ).slice(0, 24000);
    try {
      const parsed = JSON.parse(text) as { lenses?: unknown };
      lenses = normalizeLenses(parsed);
    } catch {
      lenses = [{ title: "Task text output", description: text.slice(0, 800) }];
    }
  } else {
    resultSnippet = JSON.stringify(result, null, 2).slice(0, 24000);
  }

  if (result.run.status === "failed") {
    const errMsg = result.run.error?.message ?? "Task run failed";
    return { ok: false, error: errMsg, resultSnippet, lenses };
  }

  return { ok: true, resultSnippet, lenses };
}

/**
 * Short server action: `retrieve` only until the run finishes, then one `result` fetch.
 * Avoids blocking a single action on `result({ timeout: 120 })`, which can hit Next.js
 * server-action limits and stall other actions (Search / FindAll).
 */
export async function pollAnalyticalLensesTask(runId: string): Promise<{
  pending: boolean;
  runStatus: string;
  ok: boolean;
  error?: string;
  resultSnippet: string;
  lenses: AnalyticalLens[];
}> {
  if (!runId.trim()) {
    return {
      pending: false,
      runStatus: "invalid",
      ok: false,
      error: "Missing run id",
      resultSnippet: "",
      lenses: [],
    };
  }

  let client;
  try {
    client = getParallelClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parallel client unavailable";
    return {
      pending: false,
      runStatus: "error",
      ok: false,
      error: msg,
      resultSnippet: "",
      lenses: [],
    };
  }

  try {
    const run = await client.taskRun.retrieve(runId);
    const st = run.status;

    if (st === "failed" || st === "cancelled") {
      const errMsg = run.error?.message ?? `Task ${st}`;
      return {
        pending: false,
        runStatus: st,
        ok: false,
        error: errMsg,
        resultSnippet: JSON.stringify({ run_id: runId, status: st, error: run.error }, null, 2),
        lenses: [],
      };
    }

    if (st !== "completed") {
      return {
        pending: true,
        runStatus: st,
        ok: true,
        resultSnippet: JSON.stringify(
          { run_id: runId, status: st, note: "Task still running; this panel updates on each poll." },
          null,
          2,
        ),
        lenses: [],
      };
    }

    const result = await client.taskRun.result(runId, { timeout: 45 });
    const parsed = parseTaskRunCompletedResult(result);
    return {
      pending: false,
      runStatus: st,
      ok: parsed.ok,
      error: parsed.error,
      resultSnippet: parsed.resultSnippet,
      lenses: parsed.lenses,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Task poll failed";
    return {
      pending: false,
      runStatus: "error",
      ok: false,
      error: msg,
      resultSnippet: "",
      lenses: [],
    };
  }
}

export async function startFindAllArticlesForThinker(thinkerName: string): Promise<
  | {
      ok: true;
      findallId: string;
      ingestSnippet: string;
      createSnippet: string;
    }
  | {
      ok: false;
      error?: string;
      ingestSnippet: string;
      createSnippet: string;
    }
> {
  const t = thinkerName.trim();
  if (!t) {
    return { ok: false, error: "Missing thinker name", ingestSnippet: "", createSnippet: "" };
  }

  let client;
  try {
    client = getParallelClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parallel client unavailable";
    return { ok: false, error: msg, ingestSnippet: "", createSnippet: "" };
  }

  const ingestObjective = [
    "Find at most 5 distinct English-language online news articles from reputable newspapers or magazines",
    "published in 2026 where the article substantially discusses the philosopher or public intellectual",
    `"${t}" or their ideas. Each match must be a single article page URL (https), not a generic topic page,`,
    "tag archive, social post, or directory listing. Prefer mainstream journalism.",
  ].join(" ");

  try {
    const spec = await client.beta.findall.ingest({ objective: ingestObjective });
    const ingestSnippet = formatHttpSnippet("POST", "/v1beta/findall/ingest", { objective: ingestObjective });

    const generator = spec.generator ?? "core";
    const createBody = {
      entity_type: spec.entity_type,
      generator,
      match_conditions: spec.match_conditions,
      match_limit: 5,
      objective: spec.objective,
    };
    const createSnippet = formatHttpSnippet("POST", "/v1beta/findall/runs", createBody);

    const run = await client.beta.findall.create(createBody);
    return { ok: true, findallId: run.findall_id, ingestSnippet, createSnippet };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FindAll start failed";
    return { ok: false, error: msg, ingestSnippet: "", createSnippet: "" };
  }
}

export async function pollFindAllArticlesSnapshot(findallId: string): Promise<{
  ok: boolean;
  error?: string;
  active: boolean;
  runStatus?: string;
  metrics?: { matched?: number; generated?: number };
  pollSnippet: string;
  articles: NewsArticle[];
  resultJson: string;
}> {
  if (!findallId.trim()) {
    return {
      ok: false,
      error: "Missing findall id",
      active: false,
      pollSnippet: "",
      articles: [],
      resultJson: "",
    };
  }

  let client;
  try {
    client = getParallelClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parallel client unavailable";
    return { ok: false, error: msg, active: false, pollSnippet: "", articles: [], resultJson: "" };
  }

  try {
    const run = await client.beta.findall.retrieve(findallId);
    const snapshot = await client.beta.findall.result(findallId);
    const pollSnippet = formatHttpSnippet("GET", `/v1beta/findall/runs/${findallId}`, null);

    const status = run.status.status;
    const active = run.status.is_active;
    const metrics = {
      matched: run.status.metrics.matched_candidates_count,
      generated: run.status.metrics.generated_candidates_count,
    };

    const matched = snapshot.candidates.filter(
      (c) => c.match_status === "matched" && typeof c.url === "string" && c.url.startsWith("http"),
    );

    const articles: NewsArticle[] = [];
    for (const c of matched) {
      if (articles.length >= 5) break;
      const textBlob = [c.name, c.description ?? ""].join("\n");
      articles.push({
        url: c.url,
        title: c.name || hostname(c.url),
        source: hostname(c.url),
        publishDate: null,
        snippet: (c.description ?? "").slice(0, 420),
        lensSlug: classifyLensFromText(textBlob),
      });
    }

    const resultJson = JSON.stringify(
      {
        findall_id: findallId,
        status,
        is_active: active,
        metrics,
        candidates: snapshot.candidates.map((c) => ({
          name: c.name,
          url: c.url,
          match_status: c.match_status,
          description: c.description,
        })),
      },
      null,
      2,
    ).slice(0, 24000);

    return {
      ok: true,
      active,
      runStatus: status,
      metrics,
      pollSnippet,
      articles,
      resultJson,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FindAll poll failed";
    return { ok: false, error: msg, active: false, pollSnippet: "", articles: [], resultJson: "" };
  }
}
