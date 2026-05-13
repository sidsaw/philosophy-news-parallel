import type { Metadata } from "next";
import { CompareApp } from "@/components/compare-app";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Parallel API compare — Philosophy news",
  description: "Side-by-side Task lenses, FindAll, and Search for philosopher news.",
};

export default function ComparePage() {
  return <CompareApp />;
}
