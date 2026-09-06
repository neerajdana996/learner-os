import { Link } from 'react-router-dom';
import { SampleCard } from '../SampleCard';
import { useReveal } from '../useReveal';

/**
 * What a stranger sees at `/` (T-101).
 *
 * Until now `/` was the sign-in form, so someone following a link from a
 * recruitment email was asked for their address before being told what this is
 * or what it costs them — and the ask is a week of their attention plus a
 * test they will not see coming.
 *
 * The page sells the product and is honest about the pilot, in that order. The
 * uncomfortable parts are on the page on purpose: a participant who feels
 * tricked on day 30 is a participant who drops out, and a dropout costs a tenth
 * of the result. That is the same tone onboarding already takes on every step.
 */

/** One call to action, in the same words everywhere it appears. */
const CTA = 'Take one of the ten places';

function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section id={id} ref={ref} className={['landing__section', className].filter(Boolean).join(' ')}>
      <div className="landing__inner">{children}</div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__inner landing__nav-inner">
          <span className="landing__brand">learnos</span>
          <nav className="landing__nav-links">
            <a href="#how">How it works</a>
            <a href="#why">Why it works</a>
            <a href="#pilot">The pilot</a>
            <Link className="btn btn--primary landing__nav-cta" to="/signin">
              Take a place
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------- hero */}
      <section className="landing__section landing__hero">
        <div className="landing__inner landing__hero-grid">
          <div className="u-stack u-stack--loose">
            <div className="u-stack u-stack--tight">
              <p className="u-eyebrow">Ten places &middot; one topic each</p>
              <h1 className="landing__headline">
                Learn it once. <em>Still know it</em> a month later.
              </h1>
              <p className="landing__lede">
                You understood it in the video. By Friday it was gone. learnos maps your topic,
                works out what you actually don&rsquo;t know, teaches only that — then keeps asking,
                twenty seconds at a time, until it&rsquo;s yours.
              </p>
            </div>

            <div className="u-row">
              <Link className="btn btn--primary" to="/signin">
                {CTA}
              </Link>
              <a className="btn btn--secondary" href="#how">
                See how it works
              </a>
            </div>

            <p className="landing__disclose">
              <strong>One thing to be straight about:</strong> your own topics aren&rsquo;t open yet.
              The pilot runs on three I&rsquo;ve read every question in by hand. Tell me what
              you&rsquo;d rather have learned anyway — that&rsquo;s what decides which opens next.
            </p>

            <p className="landing__evidence">
              Built on the interventions with the largest measured effect on long-term retention, in
              that order — <strong>retrieval practice</strong>, <strong>spacing</strong>,{' '}
              <strong>immediate feedback</strong>, <strong>mastery gating</strong>. Not on streaks.
            </p>
          </div>

          <SampleCard />
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <Section id="how" className="landing__section--tint">
        <div className="landing__head">
          <p className="u-eyebrow">The loop</p>
          <h2>Four things, and none of them is a video.</h2>
          <p className="landing__lede">
            A course hands you everything and hopes. This does the opposite: it works out what
            you&rsquo;re missing, teaches only that, and spends the rest of its effort making sure it
            stays.
          </p>
        </div>

        <ol className="landing__steps">
          <li>
            <div>
              <h3>It finds out what you already know</h3>
              <p>
                About fifteen questions before any teaching. Prior knowledge is the biggest single
                predictor of what sticks, so the map starts part-coloured and what you already have is
                skipped.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>You try before you&rsquo;re told</h3>
              <p>
                Every new concept opens with an attempt you will probably get wrong. Failing first and
                then seeing the explanation beats reading the explanation cold — and it is the part
                most tools skip, because it feels bad.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Then it comes and finds you</h3>
              <p>
                A Chrome extension asks one question, wherever you are, at the moment the scheduler
                thinks you are about to forget. Twenty seconds, only in hours you choose.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>You can see what is slipping</h3>
              <p>
                Your map is coloured by predicted recall, not by what you have clicked through. Amber
                means it is going this week, and the next session goes straight there.
              </p>
            </div>
          </li>
        </ol>
      </Section>

      {/* ---------------------------------------------------------- why */}
      <Section id="why">
        <div className="landing__head">
          <p className="u-eyebrow">The uncomfortable part</p>
          <h2>Why this works when the course didn&rsquo;t.</h2>
          <p className="landing__lede">
            Five decisions, every one of which makes the product less pleasant to use. They are also
            the entire reason it has a chance of working, so none of them is coming out.
          </p>
        </div>

        <div className="landing__grid">
          <article className="landing__tile landing__tile--wide">
            <p className="landing__figure u-mono">&ge; 1 day</p>
            <h3>A score you cannot farm</h3>
            <p>
              Your knowledge score moves only when you recall something correctly at least a day
              after you last saw it, and it decays on its own as forgetting is predicted. Showing up
              earns nothing, because showing up is not what is being measured.
            </p>
          </article>

          <article className="landing__tile landing__tile--wide">
            <p className="landing__figure u-mono">Try first</p>
            <h3>You fail before you are taught</h3>
            <p>
              Every new concept opens with an attempt you will probably get wrong. Struggling before
              being shown the answer produces better understanding than being shown it first — even
              though it feels considerably worse at the time.
            </p>
          </article>

          <article className="landing__tile">
            <p className="u-eyebrow">Never asked</p>
            <h3>No &ldquo;how do you learn best?&rdquo;</h3>
            <p>
              Matching teaching to &ldquo;visual&rdquo; or &ldquo;auditory&rdquo; learners has failed
              every controlled test it has been given. You will never be asked. What you actually
              remember is the only signal used.
            </p>
          </article>

          <article className="landing__tile">
            <p className="u-eyebrow">Cognitive load</p>
            <h3>Three new ideas a day, maximum</h3>
            <p>
              However far behind you are, a session never puts more than three new concepts in front
              of you. The cap is enforced rather than suggested, because a session you bail out of
              teaches nothing.
            </p>
          </article>

          <article className="landing__tile landing__tile--invert">
            <p className="u-eyebrow">Not in the box</p>
            <h3>No streaks. No badges. No coupons.</h3>
            <p>
              Extrinsic rewards reliably undermine the motivation they are meant to create. There is
              nothing here to collect. Miss a day and nothing breaks — the only thing keeping you
              here is whether it is working.
            </p>
          </article>
        </div>
      </Section>

      {/* --------------------------------------------------------- pilot */}
      <Section id="pilot" className="landing__section--invert">
        <div className="landing__head">
          <p className="u-eyebrow">Where it is right now</p>
          <h2>Ten people, and a test three weeks after you stop.</h2>
          <p className="landing__lede">
            I don&rsquo;t know yet whether this works. So the first run is small and measured
            properly: ten people, one topic each, seven days of teaching — and then a test you
            won&rsquo;t see coming, long after the app has gone quiet.
          </p>
        </div>

        <figure className="landing__timeline">
          <svg viewBox="0 0 900 150" role="img" className="landing__timeline-svg">
            <title>
              Seven days of daily sessions, then twenty-three days of silence with no cards or
              reminders, then one unannounced test on day thirty.
            </title>
            <line className="landing__axis" x1="40" y1="100" x2="870" y2="100" />
            {Array.from({ length: 7 }, (_, i) => (
              <rect
                key={i}
                className="landing__tick"
                x={55 + i * 27}
                y={100 - (34 + ((i * 7) % 22))}
                width="12"
                height={34 + ((i * 7) % 22)}
                rx="2"
              />
            ))}
            <path className="landing__quiet" d="M235,100 L826,100" />
            <line className="landing__testline" x1="838" y1="42" x2="838" y2="100" />
            <circle className="landing__testdot" cx="838" cy="42" r="5" />
            <text className="landing__tl-day" x="55" y="122">
              DAY 1
            </text>
            <text className="landing__tl-day" x="185" y="122">
              DAY 7
            </text>
            <text className="landing__tl-day" x="806" y="122">
              DAY 30
            </text>
            <text className="landing__tl-key" x="55" y="143">
              Seven days of work
            </text>
            <text className="landing__tl-key" x="360" y="143">
              Twenty-three days of silence
            </text>
            <text className="landing__tl-key" x="726" y="143">
              One cold test
            </text>
          </svg>
        </figure>

        <div className="landing__grid landing__grid--thirds">
          <article className="landing__tile landing__tile--plain">
            <h3>Why the silence matters</h3>
            <p>
              Remembering something the day after you practised it proves very little. The gap is
              the measurement. Three weeks with no cards, no sessions and no reminders is the only
              way to find out whether any of it stuck.
            </p>
          </article>
          <article className="landing__tile landing__tile--plain">
            <h3>I won&rsquo;t teach you everything</h3>
            <p>
              About one concept in ten is held back. You never see it, never review it. The test
              covers both. If the taught concepts score far higher, the teaching did that — and if
              they come out level, it didn&rsquo;t work.
            </p>
          </article>
          <article className="landing__tile landing__tile--plain">
            <h3>You get the number too</h3>
            <p>
              Whatever it says. It might show this worked, it might show it didn&rsquo;t. I&rsquo;d
              rather find that out with ten people than with a thousand, and you would be one of the
              ten answering it.
            </p>
          </article>
        </div>

        <div className="landing__head landing__head--tight">
          <p className="u-eyebrow">Before you say yes</p>
          <h3 className="landing__subhead">What I am actually asking of you.</h3>
          <p>
            I would rather you turn this down now than drop out on day four — one dropout costs a
            tenth of the result.
          </p>
        </div>

        <dl className="landing__ask">
          <div>
            <dt className="u-mono">10 min</dt>
            <dd>
              <strong>a day, for seven days.</strong> Two or three new ideas, then a few reviews.
              Then you are done and the app leaves you alone.
            </dd>
          </div>
          <div>
            <dt className="u-mono">Chrome</dt>
            <dd>
              <strong>extension, installed by hand.</strong> It is not in the Web Store yet, so you
              will load an unpacked folder in developer mode. About two minutes, and I will walk you
              through it.
            </dd>
          </div>
          <div>
            <dt className="u-mono">~12/day</dt>
            <dd>
              <strong>cards, in hours you pick.</strong> One question, twenty seconds, only inside
              windows you set. Wave three away and it stops until tomorrow.
            </dd>
          </div>
          <div>
            <dt className="u-mono">1 test</dt>
            <dd>
              <strong>unannounced, on day 30.</strong> Twenty-five to thirty questions, about
              fifteen minutes. You will not be told in advance, because a test you revised for
              measures revision.
            </dd>
          </div>
        </dl>

        <p className="landing__topics">
          One topic each, from three I have read every question in by hand:{' '}
          <strong>sliding window</strong>, <strong>dynamic programming</strong>, and{' '}
          <strong>consistency in distributed systems</strong>. Tell me what you would rather have
          learned anyway — that is what decides which topics open next.
        </p>
      </Section>

      {/* --------------------------------------------------------- close */}
      <Section className="landing__close">
        <p className="u-eyebrow">Ten places</p>
        <h2>Seven days of work. Then you find out if it stuck.</h2>
        <p className="landing__lede">
          With a number rather than a feeling — which is more than I can say for anything else
          either of us has tried.
        </p>
        <div className="landing__close-cta">
          <Link className="btn btn--primary" to="/signin">
            {CTA}
          </Link>
          <p className="u-muted">Three topics &middot; no cost, no card</p>
        </div>
      </Section>

      <footer className="landing__foot">
        <div className="landing__inner landing__foot-inner">
          <span>learnos</span>
          <Link to="/signin">Already in the pilot? Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
