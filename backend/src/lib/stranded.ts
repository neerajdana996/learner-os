/**
 * A topic stuck on `generating` with nothing behind it (T-069).
 *
 * `topics.status` leaves `generating` only from inside `processGenerationJob`.
 * A job that never gets there leaves the row saying "building" forever: the
 * wait screen polls it indefinitely, and T-065's guard hands the same dead row
 * back to every attempt to start again, so the learner cannot create a topic
 * at all.
 *
 * **"No live job", not "no job".** Generation jobs keep BullMQ's defaults, so
 * a finished job is never removed — and the commonest way to strand a topic
 * leaves one behind. A worker killed mid-job (a deploy, `tsx watch` restarting
 * on a save) is caught by BullMQ's stall checker, which eventually moves the
 * job to `failed` *without* running the job's own catch block, the only code
 * that marks the topic. Checking for absence alone would never fire on it.
 *
 * **Why an age at all**, when job state is the real signal: the row is
 * committed before its job is enqueued (T-065 keeps Redis out of the advisory
 * lock), so a brand-new topic briefly has no job for an innocent reason. Five
 * minutes is far past that gap and still short enough that a stuck learner is
 * unstuck within one lifecycle tick of it.
 *
 * **Recovery is `failed`, never a re-enqueue.** A job BullMQ reports as dead
 * may have been alive a moment ago, and a silent retry of a five-to-ten minute
 * generation risks paying for eighty model calls twice. `failed` hands the
 * learner the existing "That didn't build / Try again" path instead.
 */

export const STRANDED_AFTER_MS = 5 * 60_000;

/** Written to `topics.error`, so whoever reads the row knows it was not the model. */
export const STRANDED_ERROR =
  'generation stopped before it finished: its job is gone or died without reporting, so nothing was saved';

/** BullMQ's states for a job that may still run or is running now. `unknown`
 *  is what `getState` answers for a job it cannot find. */
const LIVE_JOB_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'waiting-children',
  'prioritized',
  'delayed',
  'active',
]);

export function jobIsLive(state: string | null): boolean {
  return state !== null && LIVE_JOB_STATES.has(state);
}

/** Old enough that a missing or dead job is no longer the enqueue gap. */
export function strandedCutoff(now: Date): Date {
  return new Date(now.getTime() - STRANDED_AFTER_MS);
}
