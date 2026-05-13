export type ParallelOpKind = "search" | "extract";

export type ParallelOpStatus = "running" | "completed" | "error";

export type ParallelOperation = {
  id: string;
  kind: ParallelOpKind;
  label: string;
  status: ParallelOpStatus;
  detail?: string;
};
