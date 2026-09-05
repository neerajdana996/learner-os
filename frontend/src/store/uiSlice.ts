import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'learnos.theme';

export interface UiState {
  theme: ThemePreference;
}

/**
 * Client state that is genuinely global and genuinely ours.
 *
 * The bar for putting something here: more than one distant component reads it,
 * and no server owns it. Theme clears that — the toggle sits in the header and
 * the value drives an attribute on `<html>`. A learner's half-typed answer does
 * not: it belongs to one question, dies with it, and routing it through the
 * store would add ceremony and re-renders for nothing.
 *
 * This replaces the old `sessionSlice`, which held a copy of `userId`/`email`.
 * That is *server* state — `GET /me` owns it, and a second copy in Redux can
 * only ever drift from it.
 */
function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private browsing, or site data blocked. Not worth failing a boot over.
  }
  return 'system';
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState: { theme: readStoredTheme() } satisfies UiState as UiState,
  reducers: {
    themeChanged(state, action: PayloadAction<ThemePreference>) {
      state.theme = action.payload;
      try {
        localStorage.setItem(STORAGE_KEY, action.payload);
      } catch {
        // The preference just won't survive a reload.
      }
    },
  },
  selectors: {
    selectTheme: (state) => state.theme,
  },
});

export const { themeChanged } = uiSlice.actions;
export const { selectTheme } = uiSlice.selectors;
export const uiReducer = uiSlice.reducer;
