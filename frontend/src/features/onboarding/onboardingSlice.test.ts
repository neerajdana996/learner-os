import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftChanged, onboardingReducer, onboardingReset, stepChanged } from './onboardingSlice';

const initial = () => onboardingReducer(undefined, { type: '@@init' });

beforeEach(() => {
  localStorage.clear();
});

describe('onboardingSlice', () => {
  it('starts on the first step with the browser timezone detected', () => {
    const state = initial();
    expect(state.step).toBe(0);
    expect(state.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('offers two sensible windows rather than an empty list', () => {
    // An empty list would make the most important consent step look optional.
    expect(initial().activeWindows.length).toBeGreaterThan(0);
  });

  it('merges partial edits without clobbering the rest of the draft', () => {
    let state = onboardingReducer(initial(), draftChanged({ topic: 'React hooks' }));
    state = onboardingReducer(state, draftChanged({ why: 'it never sticks' }));

    expect(state.topic).toBe('React hooks');
    expect(state.why).toBe('it never sticks');
  });

  it('survives a reload, which is the whole reason it is in the store', async () => {
    onboardingReducer(initial(), draftChanged({ topic: 'React hooks', budgetMin: 20 }));

    vi.resetModules();
    const fresh = await import('./onboardingSlice');
    const restored = fresh.onboardingReducer(undefined, { type: '@@init' });

    expect(restored.topic).toBe('React hooks');
    expect(restored.budgetMin).toBe(20);
  });

  it('never steps below the first', () => {
    expect(onboardingReducer(initial(), stepChanged(-3)).step).toBe(0);
  });

  it('clears the draft on reset, so a second topic does not start pre-filled', () => {
    const filled = onboardingReducer(initial(), draftChanged({ topic: 'React hooks', step: 3 }));
    const cleared = onboardingReducer(filled, onboardingReset());

    expect(cleared.topic).toBe('');
    expect(cleared.step).toBe(0);
    expect(localStorage.getItem('learnos.onboarding')).toBeNull();
  });

  it('starts clean rather than throwing on a corrupt stored draft', async () => {
    localStorage.setItem('learnos.onboarding', '{not json');

    vi.resetModules();
    const fresh = await import('./onboardingSlice');
    expect(fresh.onboardingReducer(undefined, { type: '@@init' }).step).toBe(0);
  });
});
