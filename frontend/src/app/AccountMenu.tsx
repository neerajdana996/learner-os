import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../features/auth/authApi';
import { useDevResetMutation } from '../features/dev/devApi';
import { useMeQuery } from '../features/users/usersApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectTheme, themeChanged, type ThemePreference } from '../store/uiSlice';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/**
 * The account menu (T-081).
 *
 * Everything that is not a place you go lives here — the account, the one
 * unfinished setup step, appearance, and (in development only) the reset tools.
 * The bar itself stays two links, because a header that grows a control per
 * feature is how you end up with the toolbar this replaced.
 */
export function AccountMenu() {
  const { data: me } = useMeQuery();
  const [logout] = useLogoutMutation();
  const [reset, { isLoading: resetting }] = useDevResetMutation();
  const theme = useAppSelector(selectTheme);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — the two gestures everyone tries
  // before hunting for the trigger again.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (me?.name ?? me?.email ?? '?').trim().charAt(0).toUpperCase();
  const themeLabel = THEMES.find((t) => t.value === theme)?.label ?? 'Auto';

  async function signOut() {
    setOpen(false);
    await logout().unwrap();
    // The session cookie is gone, so `/` resolves to the landing page.
    navigate('/', { replace: true });
  }

  async function runReset(scope: 'progress' | 'topics') {
    setOpen(false);
    await reset({ scope }).unwrap();
    // `topics` leaves nothing to be on, so land where the router would send a
    // learner with no course.
    if (scope === 'topics') navigate('/', { replace: true });
  }

  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="account__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={me?.email ? `Account, ${me.email}` : 'Account'}
        onClick={() => setOpen((was) => !was)}
      >
        {initial}
      </button>

      {open ? (
        <div className="menu" role="menu">
          <div className="menu__head">
            <p className="menu__name">{me?.name ?? 'Signed in'}</p>
            <p className="menu__email">{me?.email}</p>
          </div>
          <div className="menu__rule" />

          {/* The one setup step that silently goes unfinished, styled as the
              unfinished thing rather than the third row down. */}
          {me && !me.hasExtensionToken ? (
            <button
              type="button"
              role="menuitem"
              className="menu__item menu__item--hot"
              onClick={() => {
                setOpen(false);
                navigate('/connect');
              }}
            >
              <span className="menu__item-body">
                <span className="menu__item-title">Connect extension</span>
                <span className="menu__item-sub">Not set up yet</span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                navigate('/connect');
              }}
            >
              <span className="menu__item-body">Extension</span>
              <span className="menu__value">Connected</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            aria-expanded={showThemes}
            className="menu__item"
            onClick={() => setShowThemes((was) => !was)}
          >
            <span className="menu__item-body">Appearance</span>
            <span className="menu__value">{themeLabel}</span>
          </button>
          {showThemes ? (
            <div className="menu__inset">
              <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
                {THEMES.map((option) => (
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
            </div>
          ) : null}

          <button type="button" role="menuitem" className="menu__item" onClick={() => void signOut()}>
            <span className="menu__item-body">Sign out</span>
          </button>

          {/* Build-time constant, so this block and the endpoints it calls are
              dropped from the production bundle rather than hidden in it. */}
          {import.meta.env.DEV ? (
            <>
              <div className="menu__rule" />
              <p className="menu__label">Dev only</p>
              <button
                type="button"
                role="menuitem"
                className="menu__item menu__item--small"
                disabled={resetting}
                onClick={() => void runReset('progress')}
              >
                <span className="menu__item-body">Reset my progress</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu__item menu__item--small"
                disabled={resetting}
                onClick={() => void runReset('topics')}
              >
                <span className="menu__item-body">Delete topic &amp; start over</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
