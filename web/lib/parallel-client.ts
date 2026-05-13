import Parallel from "parallel-web";

export function getParallelClient(): Parallel {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    throw new Error("PARALLEL_API_KEY is not configured");
  }
  return new Parallel({ apiKey });
}
