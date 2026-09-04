import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';
import { sessionReducer } from './sessionSlice';

const rootReducer = combineReducers({
  [api.reducerPath]: api.reducer,
  session: sessionReducer,
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
