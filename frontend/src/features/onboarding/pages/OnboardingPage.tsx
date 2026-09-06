import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Choice } from '../../../components/Choice';
import { Field } from '../../../components/Field';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { ActiveWindowsSchema } from '@learnos/shared';
import { useUpdateMeMutation } from '../../users/usersApi';
import {
  FAST_POLL_WINDOW_MS,
  generationPollInterval,
  generationProgressLabel,
  useCreateTopicMutation,
  useTopicQuery,
} from '../../topics/topicsApi';
import { draftChanged, onboardingReset, selectDraft, stepChanged } from '../onboardingSlice';
import { Step, Stepper } from '../Step';
import { WindowsStep } from '../WindowsStep';

import { LANGUAGES, PILOT_TOPICS, recommendTopic, type Role } from '../topics';

// Every option maps to a topic that genuinely suits it. "I design" was dropped:
// all three pilot topics are engineering, so offering it would imply something
// for designers that isn't there.
const ROLES: { value: Role; label: string }[] = [
  { value: 'product', label: 'I build products or apps' },
  { value: 'backend', label: 'I work on backends or infrastructure' },
  { value: 'student', label: 'I’m studying' },
  { value: 'other', label: 'Something else' },
];

const BUDGETS = [5, 10, 15, 20];
const TOTAL_STEPS = 5;
const DAYS = 30;

/**
 * Onboarding as five beats rather than one form: who you are, what you want to
 * hold on to, what you can give it, when we may interrupt, and what happens
 * next. Each step says what the answer is used for, because every question here
 * feeds something specific — the windows gate the extension, the budget sizes
 * every session, and the "why" is read back on the days the learner doesn't
 * feel like starting.
 *
 * What the role does *not* do is change how anything is taught. plan.md §3.1
 * rules that out, and the diagnostic — fifteen adaptive questions measuring
 * actual recall — is a far stronger signal than any self-report. The role only
 * steers which topic is suggested first.
 */
export default function OnboardingPage() {
  const draft = useAppSelector(selectDraft);
  const dispatch = useAppDispatch();

  const [updateMe] = useUpdateMeMutation();
  const [createTopic, { isLoading: creating }] = useCreateTopicMutation();

  // `settled` latches so the interval drops to 0 the moment generation ends,
  // rather than polling for the rest of the session. Deriving the interval from
  // the query's own data would be circular.
  const [settled, setSettled] = useState(false);
  // Generation runs for minutes, so the poll backs off after the first
  // half-minute (T-066). One timer flips the rate; RTK Query picks up the new
  // interval on the re-render.
  const [waitedLong, setWaitedLong] = useState(false);
  const { data: topicState } = useTopicQuery(draft.topicId ?? '', {
    skip: !draft.topicId,
    pollingInterval: settled
      ? 0
      : generationPollInterval('generating', waitedLong ? FAST_POLL_WINDOW_MS : 0),
    skipPollingIfUnfocused: true,
  });

  useEffect(() => {
    if (!draft.topicId || settled) return;
    const timer = setTimeout(() => setWaitedLong(true), FAST_POLL_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [draft.topicId, settled]);

  const status = topicState?.status;
  useEffect(() => {
    if (status && status !== 'generating') setSettled(true);
  }, [status]);

  const set = (patch: Parameters<typeof draftChanged>[0]) => dispatch(draftChanged(patch));
  const go = (step: number) => dispatch(stepChanged(step));

  // Clears the saved draft once the learner is through, so a second topic later
  // doesn't start pre-filled with the first.
  useEffect(() => {
    if (status === 'active') dispatch(onboardingReset());
  }, [status, dispatch]);

  async function build() {
    await updateMe({
      name: draft.name.trim() || null,
      timezone: draft.timezone,
      activeWindows: draft.activeWindows,
    }).unwrap();

    const startsAt = new Date();
    const result = await createTopic({
      title: draft.topic,
      why: draft.why.trim() || undefined,
      // Omitted, not sent empty: "doesn't matter" and "never asked" are the
      // same null in the topic row, and T-092 is what fills either one in.
      language: draft.language || undefined,
      startsAt,
      endsAt: new Date(startsAt.getTime() + DAYS * 86_400_000),
      dailyBudgetMin: draft.budgetMin,
    }).unwrap();
    set({ topicId: result.topicId });
  }

  if (draft.topicId && status === 'active') {
    return <Navigate to={`/diagnostic/${draft.topicId}`} replace />;
  }

  if (draft.topicId) {
    const failed = status === 'failed';
    return (
      <div className="step">
        <h1 className="step__title">{failed ? 'That didn’t build' : 'Building your map'}</h1>
        <p className="step__lede">
          {failed
            ? (topicState?.error ?? 'Something went wrong while generating the course.')
            : 'Writing out every concept and the questions that go with them. This takes a few minutes — you can close the tab and come back.'}
        </p>
        {failed ? (
          <Button
            onClick={() => {
              set({ topicId: null });
              setSettled(false);
              setWaitedLong(false);
            }}
          >
            Try again
          </Button>
        ) : (
          // Real progress from the job, not `counts.concepts` — nothing is
          // written until the final transaction, so that number read 0 for the
          // whole six minutes and looked broken (T-064).
          <p className="stat">{generationProgressLabel(topicState?.progress)}</p>
        )}
      </div>
    );
  }

  const windowsValid = ActiveWindowsSchema.safeParse(draft.activeWindows).success;
  const recommended = recommendTopic(draft.role);

  return (
    <>
      <Stepper step={draft.step} total={TOTAL_STEPS} />

      {draft.step === 0 ? (
        <Step
          kicker="First"
          title="Who’s learning?"
          lede="Two questions, then we’ll get to the actual thing you want to remember."
          because="This only decides which topic we suggest first — both stay open. It never changes how anything is taught: what you remember is the only signal used for that."
          onNext={() => go(1)}
          nextDisabled={!draft.role}
        >
          <Field
            label="What should we call you?"
            placeholder="Neeraj"
            autoComplete="given-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />

          <fieldset className="u-stack u-stack--tight">
            <legend className="field__label">What do you do?</legend>
            <div className="choice-group">
              {ROLES.map((role) => (
                <Choice
                  key={role.value}
                  name="role"
                  checked={draft.role === role.value}
                  onSelect={() => set({ role: role.value })}
                >
                  {role.label}
                </Choice>
              ))}
            </div>
          </fieldset>
        </Step>
      ) : null}

      {draft.step === 1 ? (
        <Step
          kicker="Second"
          title="What do you keep forgetting?"
          lede="Three topics in this pilot. Every question in all of them has been read by hand before it reaches you."
          because="Your reason comes back to you on the mornings you don’t feel like starting. Nobody else sees it."
          onNext={() => go(2)}
          onBack={() => go(0)}
          nextDisabled={!draft.topic}
        >
          <fieldset>
            <legend className="u-sr-only">Choose a topic</legend>
            <div className="choice-group">
              {PILOT_TOPICS.map((t) => {
                const isPick = recommended?.title === t.title;
                return (
                  <Choice
                    key={t.title}
                    name="topic"
                    checked={draft.topic === t.title}
                    onSelect={() => set({ topic: t.title })}
                  >
                    {isPick && draft.role ? (
                      <span className="recommendation">
                        <span className="recommendation__tag">Suggested</span>
                        <span>{t.fit[draft.role] ?? 'The closer fit for what you do.'}</span>
                      </span>
                    ) : null}
                    <span className="choice__title">{t.title}</span>
                    <span className="choice__body">{t.blurb}</span>
                  </Choice>
                );
              })}
            </div>
          </fieldset>

          <Field
            label="Why this, why now?"
            placeholder="I re-learn it before every interview and lose it again."
            value={draft.why}
            onChange={(e) => set({ why: e.target.value })}
          />

          <fieldset className="u-stack u-stack--tight">
            <legend className="field__label">Which language should the examples be in?</legend>
            <p className="field__hint">
              Every snippet in the course is written in this one. Not every topic has a language —
              if yours doesn’t, or you don’t mind, the last option is a real answer and we’ll pick
              something that suits the material.
            </p>
            <div className="choice-group choice-group--inline">
              {LANGUAGES.map((language) => (
                <Choice
                  key={language}
                  name="language"
                  checked={draft.language === language}
                  onSelect={() => set({ language })}
                  inline
                >
                  {language}
                </Choice>
              ))}
              <Choice
                name="language"
                checked={draft.language === ''}
                onSelect={() => set({ language: '' })}
                inline
              >
                Doesn’t matter — you choose
              </Choice>
            </div>
          </fieldset>
        </Step>
      ) : null}

      {draft.step === 2 ? (
        <Step
          kicker="Third"
          title="How much time, honestly?"
          lede="Be realistic rather than ambitious. Over-promising on day one is the most common way thirty days turns into nine."
          because="This sizes every session. Pick ten minutes and you’ll get two new ideas plus reviews; pick five and you’ll get one."
          onNext={() => go(3)}
          onBack={() => go(1)}
        >
          <div className="u-stack u-stack--tight">
            <span className="field__label">Minutes a day</span>
            <div className="u-row">
              {BUDGETS.map((minutes) => (
                <Choice
                  key={minutes}
                  name="budget"
                  checked={draft.budgetMin === minutes}
                  onSelect={() => set({ budgetMin: minutes })}
                  inline
                >
                  {minutes}
                </Choice>
              ))}
            </div>
          </div>
        </Step>
      ) : null}

      {draft.step === 3 ? (
        <Step
          kicker="Fourth"
          title="When may we interrupt you?"
          lede="A small card, one question, about twenty seconds — and only inside the hours you set here."
          because="Recall works because it happens with a gap, away from the lesson. This is the only way the extension knows when you’re at your desk, and it never appears outside these hours."
          onNext={() => go(4)}
          onBack={() => go(2)}
          nextDisabled={!windowsValid}
        >
          <WindowsStep
            timezone={draft.timezone}
            windows={draft.activeWindows}
            onChange={(activeWindows) => set({ activeWindows })}
          />
        </Step>
      ) : null}

      {draft.step === 4 ? (
        <Step
          kicker="Before you start"
          title="Here’s exactly what happens next."
          lede="No surprises except the one that’s the whole point."
          because="You can stop at any time and I’ll still share whatever the numbers show by then."
          onNext={build}
          onBack={() => go(3)}
          nextLabel={creating ? 'Building…' : 'Build my map'}
          nextDisabled={creating}
        >
          <div className="protocol">
            <div className="protocol__row">
              <span className="protocol__when">TODAY</span>
              <span className="protocol__what">
                About fifteen questions, before any teaching, so we only teach what you don’t
                already know.
              </span>
            </div>
            <div className="protocol__row">
              <span className="protocol__when">DAY 1–29</span>
              <span className="protocol__what">
                {draft.budgetMin} minutes a day here, plus the cards while you work.
              </span>
            </div>
            <div className="protocol__row">
              <span className="protocol__when">DAY 30</span>
              <span className="protocol__what">
                A test you won’t see coming — including on a handful of concepts we deliberately
                never taught you. The gap between the two is how we know any of this worked.
              </span>
            </div>
            <div className="protocol__row">
              <span className="protocol__when">31–44</span>
              <span className="protocol__what protocol__what--quiet">
                Nothing at all. No cards, no sessions, no reminders.
              </span>
            </div>
            <div className="protocol__row">
              <span className="protocol__when">DAY 45</span>
              <span className="protocol__what">
                One more test, then your results — the number, not a feeling.
              </span>
            </div>
          </div>
        </Step>
      ) : null}
    </>
  );
}
