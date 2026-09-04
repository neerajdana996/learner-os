import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Client-side auth/session state. Server data lives in RTK Query; this slice
 * holds only what the client must remember (who is logged in).
 */
export interface SessionState {
  userId: string | null;
  email: string | null;
}

const initialState: SessionState = { userId: null, email: null };

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<{ userId: string; email: string }>) {
      state.userId = action.payload.userId;
      state.email = action.payload.email;
    },
    signedOut() {
      return initialState;
    },
  },
});

export const { signedIn, signedOut } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;
