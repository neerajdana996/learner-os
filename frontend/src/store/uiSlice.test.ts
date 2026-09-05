import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from './index';
import { selectTheme, themeChanged, uiReducer } from './uiSlice';

beforeEach(() => {
  localStorage.clear();
});

describe('uiSlice', () => {
  it('defaults to following the operating system', () => {
    expect(selectTheme(makeStore().getState())).toBe('system');
  });

  it('records an explicit choice', () => {
    const store = makeStore();
    store.dispatch(themeChanged('dark'));
    expect(selectTheme(store.getState())).toBe('dark');
  });

  it('persists the choice so it survives a reload', async () => {
    makeStore().dispatch(themeChanged('dark'));
    expect(localStorage.getItem('learnos.theme')).toBe('dark');

    // The stored value is read once, when the module loads — so a reload has to
    // be simulated by re-importing, not by building a second store.
    vi.resetModules();
    const fresh = await import('./uiSlice');
    expect(fresh.uiReducer(undefined, { type: '@@init' })).toEqual({ theme: 'dark' });
  });

  it('ignores a corrupted stored value rather than failing to boot', async () => {
    localStorage.setItem('learnos.theme', 'chartreuse');

    vi.resetModules();
    const fresh = await import('./uiSlice');
    expect(fresh.uiReducer(undefined, { type: '@@init' })).toEqual({ theme: 'system' });
  });

  it('is a plain reducer with no hidden dependencies', () => {
    expect(uiReducer(undefined, themeChanged('light'))).toEqual({ theme: 'light' });
  });
});
