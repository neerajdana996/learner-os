import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';
import { uiReducer } from './uiSlice';
import { testDraftReducer } from '../features/tests/testsSlice';
import { onboardingReducer } from '../features/onboarding/onboardingSlice';

const rootReducer = combineReducers({
  [api.reducerPath]: api.reducer,
  // Server state lives in RTK Query; slices hold only client state no server
  // owns. Right now that is the theme — see uiSlice for where the line sits.
  ui: uiReducer,
  testDraft: testDraftReducer,
  // A four-step draft that must survive a closed tab — see the slice for why
  // this clears the bar and a half-typed answer does not.
  onboarding: onboardingReducer,
});

/** Factory so tests can build an isolated store; `store` is the app singleton. */
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault().concat(api.middleware),
    preloadedState,
  });
}

export const store = makeStore();
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof rootReducer>;
export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
