import { Link } from 'react-router-dom';
import { useMeQuery } from '../../users/usersApi';
import { useMapQuery } from '../../map/mapApi';
import { useSessionQuery } from '../../session/sessionApi';
import { useTopicsQuery } from '../../topics/topicsApi';

function daysLeft(endsAt: string | null): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
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

  const remaining = daysLeft(topic.endsAt);
  const done = session?.completedToday ?? false;

  return (
    <div className="u-stack u-stack--loose">
      <div className="u-stack u-stack--tight">
        <p className="u-eyebrow">
          {topic.title} · {remaining === 0 ? 'final day' : `${remaining} days left`}
        </p>
        <div className="score">
          <span className="score__value">{map?.score ?? 0}</span>
          <span className="score__caption">
            what you&rsquo;d still recall today of everything taught so far
          </span>
        </div>
      </div>

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
          {session.newConcepts.length} new · {session.dueReviews.length} reviews
        </p>
      ) : null}

      {me && !me.hasExtensionToken ? (
        <div className="at-risk" style={{ borderLeftColor: 'var(--clay)' }}>
          <p className="at-risk__title">The extension isn&rsquo;t connected yet</p>
          <p className="at-risk__body">
            Most of the remembering happens between sessions, in twenty-second cards while
            you&rsquo;re already at your desk. Without it you&rsquo;re getting half the method.
          </p>
        </div>
      ) : null}
    </div>
  );
}
