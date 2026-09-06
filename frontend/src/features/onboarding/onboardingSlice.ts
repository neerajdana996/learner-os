import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ActiveWindow } from '@learnos/shared';
import type { Role } from './topics';

const STORAGE_KEY = 'learnos.onboarding';

/**
 * Bumped whenever the draft's shape changes. A stored draft from an older
 * version is discarded rather than merged: the `role` step was added after the
 * first drafts were saved, so merging left people on step 2 with no role — past
 * a question they were never asked. Bumped to 3 for `language` (T-091), which
 * is the same shape of bug: merging would default a stored draft to "doesn't
 * matter" and never show anyone the question.
 */
const DRAFT_VERSION = 3;

export interface OnboardingDraft {
  version: number;
  step: number;
  name: string;
  /** Routes the topic recommendation. Never used to decide *how* to teach —
   *  plan.md §3.1 rules that out, and the diagnostic is the real signal. */
  role: Role | null;
  timezone: string;
  activeWindows: ActiveWindow[];
  dailyCap: number;
  topic: string;
  why: string;
  /**
   * The language the topic's examples are written in (T-091). Empty string is
   * "doesn't matter", a real answer rather than an unanswered question — the
   * create call omits the field entirely for it, and the topic profile infers
   * one (T-092).
   */
  language: string;
  budgetMin: number;
  /** Set once the topic exists and generation is running. */
  topicId: string | null;
}

/**
 * The onboarding draft, in Redux and persisted.
 *
 * This clears the bar the way theme does and a half-typed answer does not: it
 * spans four steps, and losing it costs the learner real retyping — closing the
 * tab mid-signup and coming back to a blank form is exactly how a ten-person
 * pilot loses two of them. Persistence is the point; the store is just where
 * shared, durable client state lives.
 */
const emptyDraft: OnboardingDraft = {
  version: DRAFT_VERSION,
  step: 0,
  name: '',
  role: null,
  timezone: 'UTC',
  activeWindows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  dailyCap: 12,
  topic: '',
  why: '',
  language: '',
  budgetMin: 10,
  topicId: null,
};

function readDraft(): OnboardingDraft {
  // Detected rather than asked — the learner confirms it on the windows step,
  // where it is the thing that gives "09:00" a meaning.
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<OnboardingDraft>;
      if (parsed.version === DRAFT_VERSION) {
        return { ...emptyDraft, timezone: detected, ...parsed };
      }
    }
  } catch {
    // Corrupt or unavailable storage: start clean rather than fail to boot.
  }
  return { ...emptyDraft, timezone: detected };
}

function persist(state: OnboardingDraft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The draft just won't survive a reload.
  }
}

export const onboardingSlice = createSlice({
  name: 'onboarding',
  initialState: readDraft(),
  reducers: {
    draftChanged(state, action: PayloadAction<Partial<OnboardingDraft>>) {
      Object.assign(state, action.payload);
      persist(state);
    },
    stepChanged(state, action: PayloadAction<number>) {
      state.step = Math.max(0, action.payload);
      persist(state);
    },
    onboardingReset() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to clean up.
      }
      return readDraft();
    },
  },
  selectors: {
    selectDraft: (state) => state,
  },
});

export const { draftChanged, stepChanged, onboardingReset } = onboardingSlice.actions;
export const { selectDraft } = onboardingSlice.selectors;
export const onboardingReducer = onboardingSlice.reducer;
