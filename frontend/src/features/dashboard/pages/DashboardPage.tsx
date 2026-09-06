import { Link } from 'react-router-dom';
import { useMeQuery } from '../../users/usersApi';
import { useMapQuery } from '../../map/mapApi';
import { useSessionQuery } from '../../session/sessionApi';
import { useTopicsQuery } from '../../topics/topicsApi';

/** Same weights the server planned the session with (`lib/planner.ts`), so the
 *  estimate agrees with the budget the session was sized to. */
function minutes(newConcepts: number, reviews: number): number {
  return Math.max(1, Math.round((newConcepts * 180 + reviews * 45) / 60));
}

export default function DashboardPage() {
  const { data: me } = useMeQuery();
  const { data: topics } = useTopicsQuery();
  const topic = topics?.topics[0];
  // Shares the cache with the map page, so visiting both costs one request.
  const { data: map } = useMapQuery(topic?.id ?? '', { skip: !topic });
  const { data: session } = useSessionQuery();

  if (!topic) {
    return (
      <div className="u-stack u-measure">
        <h1>Nothing running yet</h1>
        <p className="u-muted">Pick a topic and we&rsquo;ll build your map.</p>
        <div>
          <Link className="btn btn--primary" to="/onboarding">
            Get started
          </Link>
        </div>
      </div>
    );
  }

  /**
   * The seven days are over and the topic has gone quiet until the day-30 test.
   * This is not "done for today" — there is no tomorrow to come back to, and an
   * app that keeps saying "come back tomorrow" for three weeks reads as broken.
   *
   * The test is deliberately not dated here. It is unannounced, and a countdown
   * on the dashboard is exactly the revision cue that would make it measure
   * revision instead of retention.
   */
  if (session?.courseComplete) {
    return (
      <div className="u-stack u-measure">
        <h1>That&rsquo;s the seven days done.</h1>
        <p className="u-muted">
          Nothing more to do — no sessions, no cards, nothing from the extension. The point of the
          quiet is that what you keep from here is what actually stuck.
        </p>
        <p className="u-muted">
          There is one test still to come, and you won&rsquo;t be told when. Until then your map is
          still here if you want to look at what you covered.
        </p>
        <div>
          <Link className="btn btn--secondary" to="/map">
            See your map
          </Link>
        </div>
      </div>
    );
  }

  const done = session?.completedToday ?? false;
  // The score and the day counter live in the bar now (T-081), so this page
  // leads with the thing worth acting on instead of repeating the number.
  const atRisk = map?.concepts.filter((c) => c.atRisk) ?? [];

  return (
    <div className="u-stack u-stack--loose">
      {atRisk.length > 0 ? (
        <div className="at-risk u-measure">
          <p className="at-risk__title">
            {atRisk.length === 1 ? 'One is slipping' : `${atRisk.length} are slipping`}
          </p>
          <p className="at-risk__body">
            {atRisk.map((c) => c.title).filter(Boolean).join(', ')}. Today&rsquo;s session puts
            {atRisk.length === 1 ? ' it' : ' them'} back in front of you.
          </p>
        </div>
      ) : null}

      <div className="u-row">
        {done ? (
          <button type="button" className="btn btn--primary btn--lg" disabled>
            Done for today
          </button>
        ) : (
          <Link className="btn btn--primary btn--lg" to="/session">
            Start today&rsquo;s session
          </Link>
        )}
        <Link className="btn btn--secondary" to="/map">
          See your map
        </Link>
      </div>

      {session && !done ? (
        <p className="u-muted">
          {session.newConcepts.length} new · {session.dueReviews.length} reviews · about{' '}
          {minutes(session.newConcepts.length, session.dueReviews.length)} minutes
        </p>
      ) : null}

      {me && !me.hasExtensionToken ? (
        <div className="at-risk at-risk--nudge">
          <p className="at-risk__title">The extension isn&rsquo;t connected yet</p>
          <p className="at-risk__body">
            Most of the remembering happens between sessions, in twenty-second cards while
            you&rsquo;re already at your desk. Without it you&rsquo;re getting half the method.
          </p>
          <p>
            <Link className="btn btn--secondary" to="/connect">
              Connect extension
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
