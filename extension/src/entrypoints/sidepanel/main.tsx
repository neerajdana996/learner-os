import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from '../popup/Popup';
import '../base.scss';

/**
 * The side panel (T-170).
 *
 * **The same component as the popup, deliberately.** A side panel is not a
 * different product — it is the same one question, in a surface that stays
 * open and is not dismissed by clicking away. Rendering a second card here
 * would be two implementations of the thing the whole design exists to keep
 * identical (T-126 was already that bug once, across two surfaces rather than
 * three).
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
