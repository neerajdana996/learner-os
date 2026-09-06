import { Link, useLocation } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';
import { useMapQuery } from '../features/map/mapApi';
import { useSessionQuery } from '../features/session/sessionApi';
import { useTopicsQuery } from '../features/topics/topicsApi';
import { courseDay } from '../features/map/pages/MapPage';

/**
 * The bar (T-081).
 *
 * It carries the knowledge score, because plan.md §4 wants that number visible
 * everywhere and it was on two screens out of six. Putting it in the one piece
 * of furniture every screen already has means Today and the map stop repeating
 * it, and it stops being somewhere you navigate to.
 *
 * Every slot disappears rather than showing a zero when its data is missing,
 * which is most of the first week: a mean over nothing is 0, and a large 0 on
 * day one reads as failure rather than as "nothing taught yet".
 */
export function AppBar() {
  const { pathname } = useLocation();

  // Onboarding and the diagnostic have no course to report on yet, and nowhere
  // to navigate to — the bar keeps only its name and the account.
  const lean = pathname.startsWith('/onboarding') || pathname.startsWith('/diagnostic');
  // The score is withdrawn during a session. A number in the corner is the
  // wrong thing to look at mid-recall, and watching it move is not what makes
  // anything stick.
  const inSession = pathname.startsWith('/session');

  const { data: topics } = useTopicsQuery(undefined, { skip: lean });
  const topic = topics?.topics[0];
  const { data: map } = useMapQuery(topic?.id ?? '', { skip: lean || !topic });
  const { data: session } = useSessionQuery(undefined, { skip: lean });

  const generating = topic?.status === 'generating';
  const progress = courseDay(topic?.startsAt, topic?.endsAt);
  // Only once something has actually been taught: `score` is a mean over taught
  // and known concepts, so before that it is a truthful 0 that reads as a bad
  // one.
  const taught = map?.concepts.some((c) => c.state === 'taught' || c.state === 'known') ?? false;
  const due = (session?.newConcepts.length ?? 0) + (session?.dueReviews.length ?? 0);

  let context: string | null = null;
  if (generating) {
    const p = topic?.progress;
    context = p && p.total > 0 ? `Building your map · ${p.completed} of ${p.total}` : 'Building your map';
  } else if (topic) {
    context = progress ? `${topic.title} · day ${progress.day} of ${progress.total}` : topic.title;
  }

  return (
    <header className="bar">
      <div className="bar__left">
        <Link className="bar__brand" to="/">
          learnos
        </Link>

        {!lean && context ? (
          <>
            <span className="bar__divider" aria-hidden="true" />
            <div className="bar__context">
              {/* The week-on-week delta the design shows beside this needs a
                  score from seven days ago, which no endpoint returns yet
                  (T-077). It is absent until then, never a zero. */}
              {taught && !inSession && !generating ? (
                <span className="bar__score">{map?.score}</span>
              ) : null}
              <span className="bar__topic">{context}</span>
            </div>
          </>
        ) : null}
      </div>

      <nav className="bar__nav">
        {!lean ? (
          <>
            <Link className={`bar__link${pathname === '/home' ? ' bar__link--on' : ''}`} to="/home">
              Today
              {due > 0 ? <span className="bar__badge">{due}</span> : null}
            </Link>
            <Link className={`bar__link${pathname.startsWith('/map') ? ' bar__link--on' : ''}`} to="/map">
              Map
            </Link>
          </>
        ) : null}
        <AccountMenu />
      </nav>
    </header>
  );
}
