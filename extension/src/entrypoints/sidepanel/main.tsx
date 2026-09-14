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
 * What the panel changes is only *room and persistence*. What it does not
 * change is what may be asked: `popupEligible()` still excludes `codeEditor`
 * and `orderLines`, because that rule is about **time** as much as space — the
 * promise on the card is twenty seconds, a `codeEditor` is two to four minutes
 * by design, and the same predicate decides the Day-30 test (T-093). Widening
 * it now that there is room to drop is a real question, but it is a product
 * decision with a measurement attached, not a side effect of adding a surface.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
