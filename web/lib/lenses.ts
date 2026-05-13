/**
 * Canonical philosophy “lenses” used across the app for tagging coverage.
 */
export const LENSES = [
  { slug: "ethics", label: "Ethics" },
  { slug: "epistemology", label: "Epistemology" },
  { slug: "metaphysics", label: "Metaphysics" },
  { slug: "political", label: "Political philosophy" },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "mind", label: "Philosophy of mind" },
  { slug: "logic", label: "Logic & language" },
] as const;

export type LensSlug = (typeof LENSES)[number]["slug"];

export function lensLabel(slug: LensSlug): string {
  const found = LENSES.find((l) => l.slug === slug);
  return found?.label ?? slug;
}
