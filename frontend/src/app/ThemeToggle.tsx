import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectTheme, themeChanged, type ThemePreference } from '../store/uiSlice';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/**
 * Applies the preference to `<html>` and lets the learner change it.
 *
 * "system" removes the attribute rather than resolving to a value, so the page
 * keeps following the OS if it changes while the tab is open — resolving once
 * at boot would freeze it until reload.
 */
export function useApplyTheme() {
  const theme = useAppSelector(selectTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

export function ThemeToggle() {
  const theme = useAppSelector(selectTheme);
  const dispatch = useAppDispatch();

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          className={`theme-toggle__option${theme === option.value ? ' theme-toggle__option--active' : ''}`}
          onClick={() => dispatch(themeChanged(option.value))}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
