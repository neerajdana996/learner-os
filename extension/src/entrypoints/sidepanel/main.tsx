import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from '../../card/Popup';
import '../base.scss';

/**
 * The side panel — the extension's only card surface (T-170).
 *
 * **It replaced the popup rather than joining it.** A popup closes the moment
 * the learner clicks anything else, which is the wrong shape for a question
 * they are meant to think about; the panel stays put. Keeping both would have
 * meant two surfaces rendering the same card, which is the thing the shared
 * design system exists to prevent — T-126 was already that bug once.
 *
 * The card itself now lives in `src/card/`, outside `entrypoints/`, because
 * WXT derives `action.default_popup` from an entrypoint *directory named
 * `popup`*. Leaving it there kept the icon opening a popup no matter what the
 * manifest said.
 *
 * **Every answer format may be asked here** — `orderLines` since T-170 and
 * `codeEditor` since T-171 (founder decision 2026-09-14). A `codeEditor` runs
 * through `sandbox.html`, because this page's CSP forbids the eval the web
 * runner relies on. The Day-30 test keeps its own stricter list
 * (`COLD_TEST_INELIGIBLE_KINDS`).
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
