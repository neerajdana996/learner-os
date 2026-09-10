import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Choice, Field } from '@learnos/ui';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { ActiveWindowsSchema } from '@learnos/shared';
import { useUpdateMeMutation } from '../../users/usersApi';
import {
  FAST_POLL_WINDOW_MS,
  generationPollInterval,
  generationProgressLabel,
  useCreateTopicMutation,
  useTopicQuery,
  useTopicsQuery,
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
/**
 * How long the teaching runs, in days.
 *
 * Seven, not thirty (founder decision 2026-09-06). The measurement did not move
 * — the cold test is still day 30 — but the *ask* did, from thirty days of
 * daily work to one week. Dropout is the real threat to a ten-person pilot, and
 * the gap before the test grows from nothing to twenty-three days, which is the
 * only interval at which spacing can be told apart from cramming.
 *
 * `MAX_NEW_CONCEPTS` is 3/day, so this caps a map at 21 concepts — which is why
 * the concept-map prompt asks for 14–18 rather than 20–40.
 */
const DAYS = 7;
/** `TopicCreateSchema.title`'s own floor (@learnos/shared) — matched here so
 *  free text is refused client-side for the same reason the server would
 *  400 it, not a beat later. */
const MIN_TOPIC_LENGTH = 2;

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

  /**
   * A generating or failed topic already on the server, adopted into the
   * draft even though this browser never submitted it (T-144).
   *
   * `draft.topicId` used to be the *only* source of truth for whether to show
   * the wait screen, and it lives in `localStorage` (`onboardingSlice.ts`).
   * That works within one browser — the draft survives a reload — but a
   * learner who submits step 5 on one device and opens the app from another
   * (or has cleared site data) has a `localStorage` with nothing in it, even
   * though `LandingRoute` correctly sent them here because a real topic
   * exists and isn't usable yet. Reaching `/onboarding` at all guarantees
   * every topic this user has is `generating` or `failed` — a usable one
   * would have routed to `/home` instead (`LandingRoute.tsx`'s own check) —
   * so the newest one found here is always the right one to adopt.
   */
  const { data: existingTopics } = useTopicsQuery(undefined, { skip: !!draft.topicId });
  const recoverable = useMemo(
    () =>
      existingTopics?.topics?.find(
        (t) =>
          (t.status === 'generating' || t.status === 'failed') && t.id !== draft.dismissedTopicId,
      ) ?? null,
    // A topic just dismissed via "Try again" must not come straight back —
    // without excluding `dismissedTopicId` here, this effect re-adopts the
    // same still-`failed` row on the very next render (it hasn't gone
    // anywhere server-side; nothing deletes a failed topic), landing the
    // learner right back on the screen they just left. Found live: the
    // button cleared `topicId`, this effect saw the same failed topic in
    // `GET /topics`, and set it right back — a two-fix interaction neither
    // fix alone would have caught.
    [existingTopics, draft.dismissedTopicId],
  );
  useEffect(() => {
    if (!draft.topicId && recoverable) dispatch(draftChanged({ topicId: recoverable.id }));
  }, [draft.topicId, recoverable, dispatch]);

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

  /**
   * A learner who already has a *usable* topic must not see the five-step
   * form again (E2E-002 finding, 2026-09-10) — the same bug family as T-141
   * (`/signin` had no guard against an already-signed-in visitor) and T-144
   * (this same page didn't recognise a `generating`/`failed` topic from a
   * second browser). `LandingRoute.tsx` already guards `/` with exactly this
   * "usable" definition — anything that isn't `generating` or `failed` — but
   * that guard is skipped entirely by navigating to `/onboarding` directly
   * (a bookmark, a stale tab, or simply refreshing after `localStorage` was
   * cleared), and nothing on *this* page ever checked. `recoverable` above
   * only looks for a topic still worth resuming; this checks for one already
   * finished being built.
   */
  const usableElsewhere = !recoverable && !draft.topicId &&
    existingTopics?.topics?.some((t) => t.status !== 'generating' && t.status !== 'failed');
  if (usableElsewhere) {
    return <Navigate to="/home" replace />;
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
              // `dismissedTopicId` first, in the same patch: the recovery
              // effect above reads it on the very next render, and a failed
              // topic that's still sitting in the database (nothing deletes
              // it) would otherwise be re-adopted the instant `topicId`
              // clears — the exact loop this field exists to break.
              set({ topicId: null, dismissedTopicId: draft.topicId });
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
  // Matches `TopicCreateSchema.title`'s own floor (packages/shared) — the
  // client refuses the same strings the server would 400 on, rather than
  // letting "a" through only to fail a beat later on Continue.
  const isPilotTopic = PILOT_TOPICS.some((t) => t.title === draft.topic);

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
          lede="Pick one of the three we've read every question in by hand, or type your own — that one skips the review, so it's on you to judge what comes back."
          because="Your reason comes back to you on the mornings you don’t feel like starting. Nobody else sees it."
          onNext={() => go(2)}
          onBack={() => go(0)}
          nextDisabled={!draft.topic || draft.topic.trim().length < MIN_TOPIC_LENGTH}
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

              {/**
               * Free text (T-149) — a deliberate override of the standing
               * decision in sprint.md that this waits for T-098's automated
               * critic: "hand-review does not scale to bespoke topics, and
               * unreviewed questions make the retention number meaningless."
               * That reasoning still holds; the founder chose to ship this
               * ahead of it anyway (2026-09-10). Nothing here checks the
               * string for viability beyond length — the exact failure the
               * founder's own notes already named ("any 2-120 character
               * string enqueues ~73 model calls and 5-10 minutes before
               * anyone discovers it was 'asdf'", T-096) is still live. There
               * is no length maximum shown here beyond the server's own 120
               * (`TopicCreateSchema`) — the field just accepts what's typed.
               */}
              <Choice
                name="topic"
                checked={!isPilotTopic}
                onSelect={() => {
                  if (isPilotTopic) set({ topic: '' });
                }}
              >
                <span className="choice__title">Something else</span>
                <span className="choice__body">
                  Not reviewed before it reaches you — this is what T-096 will eventually check for
                  viability. For now, use your own judgment.
                </span>
              </Choice>
            </div>
          </fieldset>

          {!isPilotTopic ? (
            <Field
              label="What do you want to remember?"
              placeholder="e.g. Kubernetes networking, or the CAP theorem"
              value={draft.topic}
              onChange={(e) => set({ topic: e.target.value })}
              autoFocus
            />
          ) : null}

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
          lede="Be realistic rather than ambitious. Over-promising on day one is the most common way a week turns into two days."
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
