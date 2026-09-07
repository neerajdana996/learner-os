import type { AdminRow, CalibrationBin } from '@learnos/shared';
import { useAdminMetricsQuery } from '../adminApi';

/** Every number here is nullable and a dash means *not measured*, never zero.
 *  A blank cell and a 0.00 cell are opposite findings. */
function Num({ value, digits = 2, sign = false }: { value: number | null; digits?: number; sign?: boolean }) {
  if (value === null) return <span className="admin__missing" title="Not measured">—</span>;
  const text = value.toFixed(digits);
  return <span className="admin__num">{sign && value > 0 ? `+${text}` : text}</span>;
}

/**
 * Predicted against actual, per 0.1 bin.
 *
 * Two bars per bin rather than one: the question is not "how did people do" but
 * "was the scheduler right", and that is only visible as a *pair*. A single bar
 * of accuracy tells you nothing about whether it was expected.
 *
 * `n` is printed under every bin because a bin with three reviews in it looks
 * exactly as tall as one with three hundred, and the eye will believe both.
 */
function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  if (bins.length === 0) {
    return <p className="admin__empty">No scored reviews yet — nothing to calibrate against.</p>;
  }

  return (
    <div className="admin__chart" role="img" aria-label="Predicted versus actual recall by bin">
      {bins.map((b) => (
        <div className="admin__bin" key={b.bin}>
          <div className="admin__bars">
            <div
              className="admin__bar admin__bar--predicted"
              style={{ height: `${Math.round(b.predicted * 100)}%` }}
              title={`predicted ${b.predicted.toFixed(2)}`}
            />
            <div
              className="admin__bar admin__bar--actual"
              style={{ height: `${Math.round(b.actual * 100)}%` }}
              title={`actual ${b.actual.toFixed(2)}`}
            />
          </div>
          <div className="admin__bin-label">{b.bin.toFixed(1)}</div>
          <div className="admin__bin-n">n={b.n}</div>
        </div>
      ))}
    </div>
  );
}

function Row({ row }: { row: AdminRow }) {
  return (
    <tr>
      <td>
        <div className="admin__who">{row.email}</div>
        <div className="admin__topic">{row.topicTitle}</div>
      </td>
      <td><Num value={row.retentionGain} sign /></td>
      <td><Num value={row.taughtDelta} sign /></td>
      <td><Num value={row.heldOutDelta} sign /></td>
      <td><Num value={row.transfer} /></td>
      {/* Negative is the improvement here — the confidence gap shrank. */}
      <td><Num value={row.calibrationGapDelta} sign /></td>
      <td><Num value={row.extension.answerRate} /></td>
      <td className="admin__counts">
        {row.extension.shown} shown · {row.extension.answered} answered ·{' '}
        {row.extension.closedNoAction} walked away
      </td>
      <td>
        <a className="admin__csv" href={`/api/admin/topics/${row.topicId}/reviews.csv`}>
          CSV
        </a>
      </td>
    </tr>
  );
}

/**
 * The founder dashboard (T-041).
 *
 * Deliberately a table, not a set of headline tiles. Ten participants is a
 * sample you read row by row — a cohort mean over ten people hides the only
 * thing worth knowing at this scale, which is *which* person it did not work
 * for and what was different about them.
 *
 * Every mean carries its `n` for the same reason.
 */
export default function AdminPage() {
  const { data, isLoading, error } = useAdminMetricsQuery();

  if (isLoading) return <p className="admin__empty">Loading…</p>;
  if (error) {
    return (
      <main className="admin">
        <h1>Results</h1>
        <p className="admin__empty">
          Not available. This page is limited to the addresses in <code>ADMIN_EMAILS</code>.
        </p>
      </main>
    );
  }
  if (!data) return null;

  const { rows, cohort } = data;

  return (
    <main className="admin">
      <h1 className="admin__title">Results</h1>
      <p className="admin__lede">
        One row per participant per topic. A dash means not measured — never zero.
      </p>

      <section className="admin__cohort">
        <Stat label="Retention gain" value={cohort.retentionGain} n={cohort.n.retentionGain} sign />
        <Stat label="Transfer" value={cohort.transfer} n={cohort.n.transfer} />
        <Stat
          label="Calibration Δ"
          value={cohort.calibrationGapDelta}
          n={cohort.n.calibrationGapDelta}
          sign
        />
        <Stat label="Answer rate" value={cohort.answerRate} n={cohort.n.answerRate} />
      </section>

      <div className="admin__scroll">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Gain</th>
              <th>Taught Δ</th>
              <th>Held-out Δ</th>
              <th>Transfer</th>
              <th>Calib. Δ</th>
              <th>Answer rate</th>
              <th>Extension</th>
              <th>Export</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="admin__empty">
                  No participants yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => <Row key={`${row.userId}-${row.topicId}`} row={row} />)
            )}
          </tbody>
        </table>
      </div>

      {rows.map((row) => (
        <section className="admin__calibration" key={`cal-${row.userId}-${row.topicId}`}>
          <h2 className="admin__subtitle">
            Scheduler calibration — {row.email}
          </h2>
          <CalibrationChart bins={row.calibration} />
        </section>
      ))}
    </main>
  );
}

function Stat({
  label,
  value,
  n,
  sign = false,
}: {
  label: string;
  value: number | null;
  n: number | undefined;
  sign?: boolean;
}) {
  return (
    <div className="admin__stat">
      <div className="admin__stat-label">{label}</div>
      <div className="admin__stat-value">
        <Num value={value} sign={sign} />
      </div>
      {/* Beside the mean, always: "0.4 across ten people" and "0.4 across one"
          are different claims and the number alone cannot tell them apart. */}
      <div className="admin__stat-n">n={n ?? 0}</div>
    </div>
  );
}
