import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Choice } from '../../../components/Choice';
import { Field } from '../../../components/Field';
import { useUpdateMeMutation } from '../../users/usersApi';
import { generationPollInterval, useCreateTopicMutation, useTopicQuery } from '../topicsApi';

/** The pilot runs two hand-checked topics, five people each (sprint.md). */
const TOPICS = [
  { title: 'React hooks', blurb: 'From what a hook is through to stale closures and custom hooks.' },
  { title: '[SECOND TOPIC]', blurb: '[ONE LINE ON WHAT IT COVERS.]' },
] as const;

const DAYS = 30;

export default function OnboardingPage() {
  const [topic, setTopic] = useState<string>(TOPICS[0].title);
  const [why, setWhy] = useState('');
  const [budget, setBudget] = useState(10);
  const [topicId, setTopicId] = useState<string | null>(null);

  const [updateMe] = useUpdateMeMutation();
  const [createTopic, { isLoading: creating }] = useCreateTopicMutation();

  // One query, polling only while the job runs and never on a backgrounded
  // tab. `settled` latches so the interval drops to 0 the moment the topic
  // reaches a terminal state, rather than polling for the rest of the session.
  const [settled, setSettled] = useState(false);
  const { data: topicState } = useTopicQuery(topicId ?? '', {
    skip: !topicId,
    pollingInterval: settled ? 0 : generationPollInterval('generating'),
    skipPollingIfUnfocused: true,
  });

  const status = topicState?.status;
  useEffect(() => {
    if (status && status !== 'generating') setSettled(true);
  }, [status]);

  async function start() {
    await updateMe({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).unwrap();
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + DAYS * 86_400_000);
    const result = await createTopic({
      title: topic,
      why: why.trim() || undefined,
      startsAt,
      endsAt,
      dailyBudgetMin: budget,
    }).unwrap();
    setTopicId(result.topicId);
  }

  // Redirect by rendering, not by calling navigate() during render — a side
  // effect in the render body fires twice under StrictMode and warns.
  if (topicId && status === 'active') {
    return <Navigate to={`/diagnostic/${topicId}`} replace />;
  }

  if (topicId) {
    const failed = status === 'failed';
    return (
      <div className="u-stack u-measure">
        <h1>{failed ? 'That didn’t build' : 'Building your map'}</h1>
        <p className="u-muted">
          {failed
            ? topicState?.error ?? 'Something went wrong while generating the course.'
            : 'Writing out every concept and the questions that go with them. This takes a few minutes — you can close the tab and come back.'}
        </p>
        {failed ? (
          <div>
            <Button onClick={() => { setTopicId(null); setSettled(false); }}>Try again</Button>
          </div>
        ) : (
          <div className="stat">
            {topicState?.counts.concepts ?? 0} concepts so far
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="u-stack u-stack--loose u-measure">
      <div className="u-stack u-stack--tight">
        <h1>Which one for the next thirty days?</h1>
        <p className="u-muted">
          Two topics in this pilot, five people on each. Every question in both has been read by hand
          before it reaches you.
        </p>
      </div>

      <fieldset>
        <legend className="u-sr-only">Choose a topic</legend>
        <div className="choice-group">
          {TOPICS.map((t) => (
            <Choice
              key={t.title}
              name="topic"
              checked={topic === t.title}
              onSelect={() => setTopic(t.title)}
            >
              <span className="choice__title">{t.title}</span>
              <span className="choice__body">{t.blurb}</span>
            </Choice>
          ))}
        </div>
      </fieldset>

      <Field
        label="Why this, why now?"
        placeholder="I re-read the docs every time and it never sticks."
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        hint="Only you see this. We show it back on the days you don’t feel like starting."
      />

      <div className="u-stack u-stack--tight">
        <div className="field__label">Minutes a day</div>
        <div className="u-row">
          {[5, 10, 15, 20].map((m) => (
            <Button
              key={m}
              variant={budget === m ? 'primary' : 'secondary'}
              onClick={() => setBudget(m)}
              aria-pressed={budget === m}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Button onClick={start} disabled={creating}>
          {creating ? 'Starting…' : 'Build my map'}
        </Button>
      </div>
    </div>
  );
}
