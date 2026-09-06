import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Confidence } from '@learnos/shared';

interface TestDraft { key: string; response: string | number | null; confidence: NonNullable<Confidence> | null; shownAt: number }
const initialState: TestDraft = { key: '', response: null, confidence: null, shownAt: 0 };
const slice = createSlice({
  name: 'testDraft', initialState,
  reducers: {
    showTestQuestion(state, { payload }: PayloadAction<{ key: string; now: number }>) {
      if (state.key === payload.key) return;
      return { ...initialState, key: payload.key, shownAt: payload.now };
    },
    setTestResponse(state, { payload }: PayloadAction<string | number>) { state.response = payload; },
    setTestConfidence(state, { payload }: PayloadAction<NonNullable<Confidence>>) { state.confidence = payload; },
  },
});
export const { showTestQuestion, setTestResponse, setTestConfidence } = slice.actions;
export const testDraftReducer = slice.reducer;
