import type { LensSlug } from "./lenses";
import { LENSES } from "./lenses";

const KEYWORDS: Record<LensSlug, string[]> = {
  ethics: [
    "ethic",
    "moral",
    "virtue",
    "rights",
    "justice",
    "harm",
    "duty",
    "care ethics",
    "bioethic",
  ],
  epistemology: [
    "epistem",
    "knowledge",
    "belief",
    "justification",
    "skeptic",
    "truth",
    "evidence",
    "rational",
  ],
  metaphysics: [
    "metaphys",
    "ontology",
    "existence",
    "being",
    "reality",
    "free will",
    "determinism",
    "causation",
  ],
  political: [
    "political",
    "democracy",
    "liberalism",
    "justice",
    "state",
    "sovereignty",
    "law",
    "rights",
    "citizen",
  ],
  aesthetics: [
    "aesthet",
    "beauty",
    "art",
    "taste",
    "sublime",
    "music",
    "literature",
  ],
  mind: [
    "consciousness",
    "mind",
    "brain",
    "qualia",
    "intentionality",
    "cognitive",
    "phenomenolog",
  ],
  logic: [
    "logic",
    "argument",
    "inference",
    "semantics",
    "paradox",
    "formal",
    "language",
  ],
};

function score(text: string, slug: LensSlug): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const kw of KEYWORDS[slug]) {
    if (t.includes(kw)) s += kw.length > 8 ? 3 : 2;
  }
  return s;
}

export function classifyLensFromText(text: string): LensSlug {
  let best: LensSlug = "ethics";
  let bestScore = -1;
  for (const lens of LENSES) {
    const slug = lens.slug;
    const s = score(text, slug);
    if (s > bestScore) {
      bestScore = s;
      best = slug;
    }
  }
  return best;
}
