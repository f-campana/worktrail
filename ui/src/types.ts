export type Signal = { type: string; detail: string };
export type Evidence = { kind: string; excerpt: string; occurredAt: string; recordLine: number };
export type Thread = { externalId: string; title: string | null; archived: boolean; lastActivity: string; resumeRef: string };
export type Card = { workstream: { id: string | null; name: string; origin: string }; score: number; confidence: string; latestActivity: string; cwd: string | null; bestThread: Thread; relatedThreads: Thread[]; relatedFiles: string[]; signals: Signal[]; latestEvidence: Evidence[] };
export type State = { query: string; best: Card | null };
export type Detail = { workstream: { status: string; aliases: string[] }; card: Card };
export type Status = { databasePath: string; latestRun: null | { completedAt: string | null; status: string }; counts: Record<string, number> };
export type Recent = { workstream: { id: string; name: string; origin: string }; latestActivity: string; confidence: string; threadCount: number };
