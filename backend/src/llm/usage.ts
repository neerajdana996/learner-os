/**
 * What each generation actually costs (T-074).
 *
 * Nothing recorded token counts, so the answer to "what does a topic cost?" was
 * a guess — for a product whose per-learner economics decide whether generated
 * topics are viable at all (T-058). Every call now reports its usage here, and
 * the worker prints a per-topic total.
 *
 * Prices are USD per million tokens, from `models.ts`. They are a *local*
 * estimate for a log line and a sanity check, not billing: the provider's
 * invoice is the source of truth, and a stale price here shows up as a slightly
 * wrong log rather than a wrong charge.
 */
export interface Usage {
  prompt: number;
  completion: number;
  /** Reasoning tokens, already counted inside `completion` by the provider. */
  reasoning: number;
}

export interface CallRecord extends Usage {
  prompt_name: string;
  model: string;
  ms: number;
  usd: number;
}

/** USD per million tokens: [input, output]. */
const PRICES: Record<string, [number, number]> = {
  'gpt-6-astra': [10, 50],
  'gpt-5.6-sol': [4, 20],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-luna': [0.2, 1.2],
};

export function estimateUsd(model: string, usage: Usage): number {
  const price = PRICES[model];
  // An unknown model costs "0" rather than throwing: a price table that can
  // fail a generation is worse than a log line that under-reports.
  if (!price) return 0;
  return (usage.prompt * price[0] + usage.completion * price[1]) / 1_000_000;
}

export type UsageListener = (record: CallRecord) => void;

let listener: UsageListener | null = null;

/**
 * Collects every call made while `run` executes. Not async-local storage: the
 * generation worker processes one job at a time, and a second concurrent
 * collector would be a bug worth failing on rather than silently interleaving.
 */
export async function collectUsage<T>(
  run: () => Promise<T>,
): Promise<{ result: T; calls: CallRecord[]; usd: number }> {
  if (listener) throw new Error('collectUsage: already collecting — generations must not overlap');

  const calls: CallRecord[] = [];
  listener = (record) => calls.push(record);
  try {
    const result = await run();
    return { result, calls, usd: calls.reduce((sum, call) => sum + call.usd, 0) };
  } finally {
    listener = null;
  }
}

export function recordUsage(record: CallRecord): void {
  listener?.(record);
}

/** One line per call, only when someone asked for it — generation is dozens of
 *  calls and this is noise in a normal dev session. */
export const LOG_EVERY_CALL = process.env.LLM_LOG_CALLS === '1';
