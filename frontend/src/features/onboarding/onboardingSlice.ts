import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ActiveWindow } from '../../shared';
import type { Role } from './topics';

const STORAGE_KEY = 'learnos.onboarding';

export interface OnboardingDraft {
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
  budgetMin: 10,
  topicId: null,
};

function readDraft(): OnboardingDraft {
  // Detected rather than asked — the learner confirms it on the windows step,
  // where it is the thing that gives "09:00" a meaning.
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...emptyDraft, timezone: detected, ...JSON.parse(stored) };
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
