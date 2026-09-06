import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ConfidenceTap, QuestionCard } from '@learnos/ui';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { useAnswerColdTestMutation, useColdTestQuery, useCompleteColdTestMutation } from '../testsApi';
import { setTestConfidence, setTestResponse, showTestQuestion } from '../testsSlice';

const percent = (value: number | null) => value === null ? 'Not measured' : `${Math.round(value * 100)}%`;
export default function TestPage() {
  const { testId = '' } = useParams();
  const { currentData: data, isLoading, isError, refetch } = useColdTestQuery(testId);
  const [answer, answerState] = useAnswerColdTestMutation();
  const [complete, completeState] = useCompleteColdTestMutation();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((state) => state.testDraft);
  const key = `${testId}/${data?.item?.itemId ?? ''}`;
  useEffect(() => { dispatch(showTestQuestion({ key, now: Date.now() })); }, [key, dispatch]);

  if (isLoading) return <p className="u-muted">Loading your recall check…</p>;
  if (isError || !data) return <div className="u-stack u-measure">
    <h1>We couldn’t open this recall check</h1><p>Check that you are signed in to the account that received the invitation.</p>
    <Button onClick={() => void refetch()}>Try again</Button>
  </div>;
  if (data.completed && data.scores) return <div className="u-stack u-measure">
    <h1>Your recall check is complete</h1>
    <p>You answered {data.progress.total} questions. Here is what you recalled.</p>
    <dl>
      <dt>Overall</dt><dd>{percent(data.scores.overall)}</dd>
      <dt>Taught concepts · direct questions</dt><dd>{percent(data.scores.taught)}</dd>
      <dt>Untaught comparison concepts</dt><dd>{percent(data.scores.heldOut)}</dd>
      <dt>Applying ideas to new situations</dt><dd>{percent(data.scores.transfer)}</dd>
    </dl>
    <p className="u-muted">These are recall scores from this check. Measuring improvement also requires comparison with your starting assessment.</p>
    <Link to="/home">Back home</Link>
  </div>;
  if (data.done) return <div className="u-stack u-measure">
    <h1>Every answer is saved</h1><p>Finish the check to see your results.</p>
    {completeState.isError ? <p role="alert">We couldn’t finish the check. Your answers are saved; please try again.</p> : null}
    <Button disabled={completeState.isLoading} onClick={() => void complete(testId)}>{completeState.isLoading ? 'Finishing…' : 'Finish and see results'}</Button>
  </div>;
  if (!data.item) return null;
  const item = data.item;
  const busy = answerState.isLoading || draft.key !== key;
  const submit = (response: string | number | null) => {
    if (!draft.confidence || busy) return;
    void answer({ id: testId, answer: { itemId: item.itemId, response, confidence: draft.confidence,
      latencyMs: Math.max(0, Date.now() - draft.shownAt) } });
  };
  return <div className="u-stack u-stack--loose u-measure">
    <p className="u-muted">Recall check · {data.progress.answered + 1} of {data.progress.total}</p>
    <p>Answer from memory, without looking things up. We’ll show your results at the end.</p>
    <fieldset disabled={busy}>
      <QuestionCard item={item} value={draft.response} onChange={(value) => dispatch(setTestResponse(value))} />
      <ConfidenceTap value={draft.confidence} onChange={(value) => dispatch(setTestConfidence(value))} />
    </fieldset>
    {answerState.isError ? <p role="alert">We couldn’t save your answer. It is still here; please try again.</p> : null}
    <div className="u-row">
      <Button disabled={busy || !draft.confidence || draft.response === null || draft.response === ''} onClick={() => submit(draft.response)}>
        {answerState.isLoading ? 'Saving…' : 'Save answer'}
      </Button>
      <Button disabled={busy || !draft.confidence} onClick={() => submit(null)}>I don’t know</Button>
    </div>
    <p className="u-muted">Each submitted answer is saved. You can close this page and resume later.</p>
  </div>;
}
