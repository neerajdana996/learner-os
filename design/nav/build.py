"""Writes the page artboards. One BAR definition, pasted into each file —
artboards share nothing at runtime, so the duplication is by design; doing it
here keeps every page's bar identical."""
import json, os

HEAD = '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
  <style>
    body { margin: 0; font-family: "IBM Plex Sans", system-ui, sans-serif; background: #FAF8F5; color: #2B2723; }
    a { color: #B0552F; } a:hover { color: #8A4225; }
    .lbl { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #8A827A; }
    .mono { font-family: "IBM Plex Mono", monospace; }
    .rule { height: 1px; background: #E6E1DA; }
    .frame { background: #FAF8F5; border: 1px solid #E6E1DA; border-radius: 6px; overflow: hidden; }
    .card { background: #FFFFFF; border: 1px solid #E6E1DA; border-radius: 6px; }
    .btn { display: inline-flex; align-items: center; min-height: 48px; padding: 0 24px; border-radius: 4px; font-size: 15px; font-weight: 500; }
    .btn--primary { background: #B0552F; color: #FFF8F4; }
    .btn--secondary { border: 1px solid #C9C2B9; padding: 0 21px; }
    /* the dynamic-data spec beside each page */
    .spec { font-size: 12px; line-height: 1.6; color: #57504A; }
    .spec__row { display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 12px; padding: 7px 0; border-top: 1px solid #E6E1DA; }
    .spec__k { font-family: "IBM Plex Mono", monospace; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: #8A827A; padding-top: 1px; }
    .tag { font-family: "IBM Plex Mono", monospace; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; }
    .tag--live { background: #E9F0EA; color: #3F6349; }
    .tag--todo { background: #F7EDE7; color: #8A4225; }
  </style>
</helmet>
'''
FOOT = '</x-dc>\n</body>\n</html>\n'

def bar(score='67', trend='4', topic='React hooks · day 12', due='5', active='Today',
        initial='D', lean=False):
    """The T3 bar. `lean` drops the score/topic block — onboarding and the
    diagnostic have no course to report on yet."""
    left = f'''<div style="font-family: 'Newsreader', serif; font-size: 19px; font-weight: 600;">learnos</div>'''
    if not lean:
        trend_html = ''
        if trend:
            trend_html = (f'<span style="display: inline-flex; align-items: center; gap: 3px;" class="mono">'
                          f'<svg width="8" height="8" viewBox="0 0 12 12" fill="#4F7A5B"><path d="M6 1.5l4.5 7.5h-9z"/></svg>'
                          f'<span style="font-size: 11px; color: #4F7A5B;">{trend}</span></span>')
        score_html = f'''<span class="mono" style="font-size: 21px; font-weight: 500; letter-spacing: -0.02em;">{score}</span>''' if score else ''
        left += f'''
        <div style="width: 1px; height: 26px; background: #E6E1DA;"></div>
        <div style="display: flex; align-items: baseline; gap: 8px;">{score_html}{trend_html}
          <span class="lbl" style="margin-left: 4px;">{topic}</span>
        </div>'''
    due_html = (f'<span class="mono" style="font-size: 11px; color: #FFF8F4; background: #B0552F; '
                f'border-radius: 999px; padding: 1px 7px;">{due}</span>') if due else ''
    def item(name):
        on = name == active
        w = 'font-weight: 500;' if on else ''
        c = '#2B2723' if on else '#57504A'
        extra = due_html if name == 'Today' else ''
        return (f'<div style="display: flex; align-items: center; gap: 7px; font-size: 14px; color: {c}; {w}">'
                f'{name}{extra}</div>')
    return f'''  <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 44px; border-bottom: 1px solid #E6E1DA;">
    <div style="display: flex; align-items: center; gap: 20px;">{left}</div>
    <div style="display: flex; gap: 26px; align-items: center;">
      {item('Today')}
      {item('Map')}
      <div style="width: 34px; height: 34px; border-radius: 50%; border: 1px solid #C9C2B9; color: #57504A; display: flex; align-items: center; justify-content: center;" class="mono">{initial}</div>
    </div>
  </div>'''

def spec(rows):
    out = '<div class="spec">'
    for k, v in rows:
        out += f'<div class="spec__row"><div class="spec__k">{k}</div><div>{v}</div></div>'
    return out + '</div>'

def page(title, kicker, blurb, body, rows, spec_title='What is live'):
    return (HEAD + f'''
<div style="padding: 34px 38px;">
  <div class="lbl" style="margin-bottom: 8px;">{kicker}</div>
  <div style="font-family: 'Newsreader', serif; font-size: 25px; font-weight: 500; letter-spacing: -0.015em; margin-bottom: 8px;">{title}</div>
  <div style="font-size: 13px; line-height: 1.65; color: #57504A; max-width: 640px; margin-bottom: 24px;">{blurb}</div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) 316px; gap: 34px; align-items: start;">
    <div class="frame">{body}</div>
    <div>
      <div class="lbl" style="margin-bottom: 10px;">{spec_title}</div>
      {spec(rows)}
    </div>
  </div>
</div>
''' + FOOT)

LIVE = '<span class="tag tag--live">live</span>'
TODO = '<span class="tag tag--todo">to build</span>'

# ---------------------------------------------------------------- 1. THE BAR
def barstate(label, note, html):
    return f'''<div style="margin-bottom: 22px;">
      <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 7px;">
        <span class="lbl" style="color: #2B2723;">{label}</span>
        <span style="font-size: 12px; color: #8A827A;">{note}</span>
      </div>
      <div class="frame">{html}</div>
    </div>'''

bar_states = (
    barstate('Mid-course', 'everything present', bar())
  + barstate('First days', 'nothing taught yet, so no score and no trend',
             bar(score='', trend='', topic='React hooks · day 1', due='3'))
  + barstate('Building', 'topic generating — the bar reports the job',
             bar(score='', trend='', topic='Building your map · 12 of 36', due=''))
  + barstate('No topic', 'signed in, nothing started', bar(lean=True, due=''))
  + barstate('During a session', 'score deliberately withdrawn — see the note',
             bar(score='', trend='', topic='React hooks · day 12', due='', active='Today'))
)

open('Main.dc.html','w').write(page(
  'One bar, five states',
  'The bar · specified',
  'Every slot is driven by something the API already returns, except the trend. The interesting part is what each slot does when its data is missing — which is most of the first week.',
  bar_states,
  [
    ('Score', f'{LIVE} <code>GET /topics/:id/map</code> → <code>score</code>, 0–100. Hidden until at least one concept is taught, because a mean over nothing is 0 and a big 0 reads as failure on day one.'),
    ('Trend', f'{TODO} No endpoint returns last week&rsquo;s score (T-077). Until it does, the caret is absent — not zero.'),
    ('Topic · day', f'{LIVE} <code>GET /topics</code> → <code>title</code>, <code>startsAt</code>, <code>endsAt</code>. Day 1 is the start date, clamped at the end.'),
    ('Building', f'{LIVE} <code>status = generating</code> replaces the score with the job&rsquo;s own progress: <code>progress.completed</code> of <code>progress.total</code>.'),
    ('Due badge', f'{LIVE} <code>GET /session</code> → <code>newConcepts.length + dueReviews.length</code>. Absent at zero rather than showing a 0.'),
    ('Initial', f'{LIVE} <code>GET /me</code> → <code>name</code>, else the first letter of <code>email</code>.'),
    ('In session', f'{TODO} The score is withdrawn while a session is open. A number in the corner is the wrong thing to be looking at mid-recall, and watching it move is not what makes anything stick.'),
  ],
  'Where each slot comes from'))

# ---------------------------------------------------------------- 2. TODAY
today_body = bar(active='Today') + '''
  <div style="padding: 38px 44px 44px;">
    <div class="lbl" style="margin-bottom: 12px;">Three are slipping</div>
    <div class="card" style="border-left: 3px solid #B8873A; padding: 16px 18px; max-width: 440px; margin-bottom: 30px;">
      <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">Dependency arrays, cleanup, stale closures</div>
      <div style="font-size: 13px; line-height: 1.6; color: #57504A;">Today&rsquo;s session puts all three in front of you.</div>
    </div>
    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div class="btn btn--primary">Start today&rsquo;s session</div>
      <div class="btn btn--secondary">See your map</div>
    </div>
    <div style="font-size: 13px; color: #8A827A;">1 new concept &middot; 4 reviews &middot; about 8 minutes</div>
  </div>'''

open('Today.dc.html','w').write(page(
  'Today',
  'Page · /home',
  'With the score in the bar, this page stops repeating it and leads with the one thing worth acting on: what is slipping. The big number moves upstairs.',
  today_body,
  [
    ('At risk', f'{LIVE} map concepts where <code>atRisk</code> is true — taught, and predicted recall under 0.6. The block is absent when none are.'),
    ('Buttons', f'{LIVE} <code>GET /session</code> → <code>completedToday</code> swaps the primary button for a disabled &ldquo;Done for today&rdquo;.'),
    ('The line', f'{LIVE} counts from <code>newConcepts</code> and <code>dueReviews</code>; the minutes use the planner&rsquo;s own weights (180s a concept, 45s a review) so it agrees with the budget the session was sized to.'),
    ('Empty', f'{LIVE} no topic → &ldquo;Nothing running yet&rdquo; and a link to onboarding.'),
    ('Gone', f'{TODO} The 62px score leaves this page. It is in the bar on every screen now, so repeating it here is just the same number twice.'),
  ]))

# ---------------------------------------------------------------- 3. SESSION
session_body = bar(score='', trend='', topic='React hooks · day 12', due='', active='Today') + '''
  <div style="padding: 30px 44px 40px;">
    <div class="lbl" style="margin-bottom: 10px;">Concept 1 of 1 &middot; then 4 reviews</div>
    <div class="lbl" style="color: #57504A; margin-bottom: 16px;">New concept &middot; Cleanup</div>

    <div class="card" style="padding: 22px 24px; max-width: 560px; margin-bottom: 12px;">
      <div class="lbl" style="margin-bottom: 10px;">How to hold it</div>
      <div style="font-size: 16px; line-height: 1.7;">An effect that subscribes to something must also say how to stop. The function it returns runs before the next effect and on unmount.</div>
      <div style="display: inline-flex; align-items: center; gap: 6px; color: #B0552F; font-size: 14px; font-weight: 500; margin-top: 14px;">Read more
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l4 4 4-4"/></svg>
      </div>
    </div>

    <div style="background: #2B2723; color: #FAF8F5; border-radius: 6px; padding: 22px 24px; max-width: 560px;">
      <div class="lbl" style="color: #A9A29B; margin-bottom: 10px;">Now without looking</div>
      <div style="font-family: 'Newsreader', serif; font-size: 21px; line-height: 1.35;">What does the function returned from an effect do?</div>
      <div style="background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); border-radius: 4px; min-height: 46px; margin-top: 16px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; color: #8F877F;">In your own words&hellip;</div>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; max-width: 560px; margin-top: 18px;">
      <div style="display: flex; gap: 12px; align-items: center;">
        <div class="btn btn--primary">Check</div>
        <div style="font-size: 14px; color: #8A827A;">Skip this one</div>
      </div>
      <div class="lbl">~5 min left</div>
    </div>
  </div>'''

open('Session.dc.html','w').write(page(
  'A session, with the score put away',
  'Page · /session',
  'The one screen where the bar gives something up. Everything else stays, so you can still leave — but the number goes, because the whole point of this screen is retrieving something rather than watching a gauge.',
  session_body,
  [
    ('Bar', f'{TODO} score and trend hidden while a session is in progress; topic and day stay, so you always know where you are.'),
    ('Steps', f'{LIVE} <code>GET /session</code> → the new concepts, then <code>dueReviews</code>, walked in order (T-073).'),
    ('Teach mode', f'{LIVE} <code>teachMode</code> decides whether the try-first card comes before the explanation. It is the A/B, so the two arms genuinely differ.'),
    ('Prose', f'{LIVE} <code>explanationShort</code> / <code>explanationLong</code>, with inline code spans rendered as chips.'),
    ('Time left', f'{LIVE} remaining steps &times; the planner&rsquo;s weights.'),
    ('Reviews', f'{LIVE} labelled &ldquo;From an earlier day&rdquo;, no teaching attached — the gap is what makes it worth anything.'),
  ]))

# ---------------------------------------------------------------- 4. MAP
def concept_row(dot, name, val, quiet=False, risk=False):
    bg = '#F1EDE6' if quiet else '#FFFFFF'
    border = '#E6E1DA' if not risk else '#B8873A'
    bl = 'border-left: 2px solid #B8873A;' if risk else ''
    col = '#8A827A' if quiet else '#2B2723'
    vcol = '#B8873A' if risk else ('#A9A29B' if quiet else '#57504A')
    return (f'<div style="display: flex; align-items: center; gap: 10px; background: {bg}; border: 1px solid {border}; {bl} '
            f'border-radius: 4px; padding: 10px 12px; font-size: 13.5px; color: {col};">{dot}'
            f'<span style="flex-grow: 1;">{name}</span><span class="mono" style="font-size: 12px; color: {vcol};">{val}</span></div>')

SOLID = '<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#4F7A5B"/></svg>'
RISK  = '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M1 7a6 6 0 0 1 12 0z" fill="#B8873A"/><circle cx="7" cy="7" r="6" fill="none" stroke="#B8873A" stroke-width="1.5"/></svg>'
OPEN  = '<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="none" stroke="#A9A29B" stroke-width="1.5"/></svg>'
HELD  = '<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="none" stroke="#A9A29B" stroke-width="1.5" stroke-dasharray="2.5 2.5"/></svg>'

map_body = bar(active='Map') + '''
  <div style="padding: 30px 44px 40px;">
    <div style="display: flex; gap: 22px; align-items: center; margin-bottom: 22px; flex-wrap: wrap;">
      <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #57504A;">''' + SOLID + '''Solid &middot; 14</span>
      <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #57504A;">''' + RISK + '''Slipping &middot; 3</span>
      <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #57504A;">''' + OPEN + '''Not taught yet &middot; 4</span>
      <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #57504A;">''' + HELD + '''Held back &middot; 2</span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;">
      <div>
        <div class="lbl" style="margin-bottom: 10px;">Foundations</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ''' + concept_row(SOLID, 'What a hook is', '0.96') + concept_row(SOLID, 'useState', '0.94') + concept_row(HELD, 'Held back until day 30', '?', quiet=True) + '''
        </div>
      </div>
      <div>
        <div class="lbl" style="margin-bottom: 10px;">Effects</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ''' + concept_row(SOLID, 'useEffect', '0.81') + concept_row(RISK, 'Dependency arrays', '0.52', risk=True) + concept_row(RISK, 'Cleanup functions', '0.48', risk=True) + '''
        </div>
      </div>
      <div>
        <div class="lbl" style="margin-bottom: 10px;">Still ahead</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ''' + concept_row(OPEN, 'useMemo', '—', quiet=True) + concept_row(OPEN, 'Custom hooks', '—', quiet=True) + '''
          <div style="background: #F1EDE6; border-radius: 4px; padding: 12px 13px; font-size: 12px; line-height: 1.6; color: #57504A;">
            <strong>Why two are hidden.</strong> We never teach these. On day 30 you are tested on them alongside everything else — the difference is how we know the teaching did anything.
          </div>
        </div>
      </div>
    </div>
  </div>'''

open('Map.dc.html','w').write(page(
  'The map',
  'Page · /map',
  'Unchanged except at the top: the score and the day counter move into the bar, which buys back a whole band of vertical space for the thing people actually came to look at.',
  map_body,
  [
    ('Concepts', f'{LIVE} <code>GET /topics/:id/map</code> → each with <code>state</code>, <code>mastery</code>, <code>atRisk</code>.'),
    ('Held back', f'{LIVE} <code>title</code> comes back <strong>null</strong> for held-out concepts — the server never sends it, so it cannot leak. The row shows &ldquo;?&rdquo;.'),
    ('Mastery', f'{LIVE} <code>predictedRecall(card)</code> at request time — never a stored column, so it can never drift from the scheduler.'),
    ('Groups', f'{LIVE} slices of five by teaching order. First is &ldquo;Foundations&rdquo;, last &ldquo;Still ahead&rdquo;; the middles are &ldquo;Part 2, 3, 4&rdquo; today, which is honest but dull — naming them needs the generator to emit group names.'),
    ('Header', f'{TODO} score, delta and day counter leave this page for the bar.'),
  ]))

# ---------------------------------------------------------------- 5. ONBOARDING
onb_body = bar(lean=True, due='') + '''
  <div style="padding: 34px 44px 40px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 22px;">
      <div style="flex-grow: 1; max-width: 300px; height: 3px; background: #E6E1DA; border-radius: 999px; overflow: hidden;">
        <div style="width: 40%; height: 100%; background: #B0552F;"></div>
      </div>
      <span class="lbl">Step 2 of 5</span>
    </div>
    <div style="font-family: 'Newsreader', serif; font-size: 32px; font-weight: 500; line-height: 1.15; letter-spacing: -0.02em; max-width: 560px; margin-bottom: 8px;">Which one for the next thirty days?</div>
    <div style="font-size: 14px; line-height: 1.6; color: #57504A; max-width: 520px; margin-bottom: 22px;">Three, not thirty, because every question in all of them is read by hand before anyone sees it.</div>
    <div style="display: flex; flex-direction: column; gap: 10px; max-width: 520px;">
      <div style="border: 1.5px solid #B0552F; background: #F7EDE7; border-radius: 4px; padding: 15px 17px;">
        <div style="font-family: 'Newsreader', serif; font-size: 19px; font-weight: 500;">Sliding window</div>
        <div style="font-size: 13px; line-height: 1.55; color: #57504A; margin-top: 4px;">When the window grows, when it must shrink, and what invariant you are holding.</div>
        <div class="lbl" style="margin-top: 8px;">40 concepts &middot; 3 places left</div>
      </div>
      <div class="card" style="padding: 15px 17px;">
        <div style="font-family: 'Newsreader', serif; font-size: 19px; font-weight: 500;">Dynamic programming</div>
        <div style="font-size: 13px; line-height: 1.55; color: #57504A; margin-top: 4px;">Memoisation, tabulation, and the part everyone gets stuck on: choosing the state.</div>
      </div>
    </div>
  </div>'''

open('Onboarding.dc.html','w').write(page(
  'Onboarding, with the bar stripped back',
  'Page · /onboarding',
  'There is no course yet, so the bar has nothing to report. It keeps the name and the account — you can still sign out or switch — and drops the score, the topic and the due badge rather than showing zeroes.',
  onb_body,
  [
    ('Bar', f'{TODO} lean state: no score, no topic, no badge. Today and Map hide too — there is nowhere to go yet.'),
    ('Topics', f'{TODO} the three are hard-coded in the client today. &ldquo;40 concepts&rdquo; is real (<code>counts.concepts</code>) only after generation; before that it should be absent, not invented.'),
    ('Places left', f'{TODO} nothing counts pilot places. Either wire it to a real count or cut the line — a fake scarcity number in a study about honesty is the wrong trade.'),
    ('Steps', f'{LIVE} five steps, held in a Redux draft that survives a closed tab.'),
    ('Building', f'{LIVE} after &ldquo;Build my map&rdquo; the wait screen reports the job&rsquo;s real progress; the bar shows the same count.'),
  ]))

# ---------------------------------------------------------------- 6. DIAGNOSTIC
diag_body = bar(score='', trend='', topic='React hooks · before we start', due='', lean=False) + '''
  <div style="padding: 30px 44px 40px;">
    <div style="display: flex; align-items: center; justify-content: space-between; max-width: 560px; margin-bottom: 18px;">
      <span class="lbl">Question 6 &middot; at most 15</span>
      <div style="display: flex; gap: 4px;">''' + ''.join(
        f'<span style="width: 14px; height: 3px; border-radius: 999px; background: {"#B0552F" if i < 6 else "#E6E1DA"};"></span>' for i in range(15)
      ) + '''</div>
    </div>
    <div style="font-size: 13px; line-height: 1.6; color: #8A827A; max-width: 500px; margin-bottom: 20px;">Getting these wrong costs you nothing &mdash; it just means we teach that part properly rather than skipping it.</div>

    <div class="card" style="padding: 24px 26px; max-width: 560px;">
      <div class="lbl" style="margin-bottom: 10px;">Dependency arrays</div>
      <div style="font-family: 'Newsreader', serif; font-size: 21px; line-height: 1.35; margin-bottom: 18px;">An effect has an empty dependency array. When does it run again after the first render?</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="border: 1px solid #C9C2B9; border-radius: 4px; min-height: 46px; display: flex; align-items: center; padding: 0 14px; font-size: 14px;">Whenever any state in the component changes</div>
        <div style="border: 1.5px solid #B0552F; background: #F7EDE7; border-radius: 4px; min-height: 46px; display: flex; align-items: center; padding: 0 14px; font-size: 14px; font-weight: 500;">Never, until it unmounts and mounts again</div>
        <div style="border: 1px solid #C9C2B9; border-radius: 4px; min-height: 46px; display: flex; align-items: center; padding: 0 14px; font-size: 14px;">On every render</div>
      </div>
    </div>
  </div>'''

open('Diagnostic.dc.html','w').write(page(
  'The diagnostic',
  'Page · /diagnostic/:topicId',
  'Fifteen questions before anything is taught. No score can exist yet — nothing has been taught — so the bar carries the topic and a plain &ldquo;before we start&rdquo; instead of a zero.',
  diag_body,
  [
    ('Bar', f'{TODO} topic without a day number, no score, no badge. Nav hidden: leaving halfway is not a supported state.'),
    ('Question', f'{LIVE} <code>GET /diagnostic/:id/next</code> → the concept and one item, answer key stripped server-side.'),
    ('Adaptive', f'{LIVE} right answers push the walk forward, wrong ones fall back to a prerequisite; it stops at 15 or when the map resolves. The ticks show <code>progress.asked</code>.'),
    ('No scheduling', f'{LIVE} answers are recorded with <code>surface=diagnostic</code> and touch no card. Measuring prior knowledge must not move a schedule, or day 0 contaminates the comparison it anchors.'),
    ('Confidence', f'{LIVE} required before each answer, never pre-selected — an untapped default would silently become data.'),
  ]))

# ---------------------------------------------------------------- 7. CONNECT
conn_body = bar(active='') + '''
  <div style="padding: 34px 44px 40px;">
    <div style="font-family: 'Newsreader', serif; font-size: 30px; font-weight: 500; letter-spacing: -0.02em; margin-bottom: 8px;">Connect the extension</div>
    <div style="font-size: 14px; line-height: 1.6; color: #57504A; max-width: 520px; margin-bottom: 26px;">Most of the remembering happens between sessions &mdash; a twenty-second question while you are already at your desk.</div>

    <div style="display: flex; flex-direction: column; gap: 20px; max-width: 560px;">
      <div style="display: flex; gap: 15px;">
        <div style="width: 26px; height: 26px; flex: none; border-radius: 50%; border: 1px solid #C9C2B9; display: flex; align-items: center; justify-content: center;" class="mono"><span style="font-size: 12px; color: #8A827A;">1</span></div>
        <div><div style="font-size: 14px; font-weight: 600; margin-bottom: 3px;">Install it</div>
        <div style="font-size: 13px; line-height: 1.6; color: #57504A;">Not in the Web Store yet. Developer mode, Load unpacked, pick the folder.</div></div>
      </div>
      <div style="display: flex; gap: 15px;">
        <div style="width: 26px; height: 26px; flex: none; border-radius: 50%; border: 1px solid #C9C2B9; display: flex; align-items: center; justify-content: center;" class="mono"><span style="font-size: 12px; color: #8A827A;">2</span></div>
        <div style="flex-grow: 1;"><div style="font-size: 14px; font-weight: 600; margin-bottom: 3px;">Get your token</div>
        <div style="font-size: 13px; line-height: 1.6; color: #57504A; margin-bottom: 10px;">A key to your account. Shown once.</div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <div style="flex-grow: 1; background: #F1EDE6; border: 1px solid #E6E1DA; border-radius: 4px; padding: 11px 13px; font-size: 13px; word-break: break-all;" class="mono">ODnDoF-BoSxHm4aIrSuYM2xBBzgpy9QL0JZdKrV3W_k</div>
          <div class="btn btn--secondary" style="min-height: 40px;">Copy</div>
        </div></div>
      </div>
      <div style="display: flex; gap: 15px;">
        <div style="width: 26px; height: 26px; flex: none; border-radius: 50%; border: 1px solid #C9C2B9; display: flex; align-items: center; justify-content: center;" class="mono"><span style="font-size: 12px; color: #8A827A;">3</span></div>
        <div><div style="font-size: 14px; font-weight: 600; margin-bottom: 3px;">Paste it in</div>
        <div style="font-size: 13px; line-height: 1.6; color: #57504A;">Click the icon, then Connect. Questions appear only inside the hours you chose.</div></div>
      </div>
    </div>
  </div>'''

open('Connect.dc.html','w').write(page(
  'Connect the extension',
  'Page · /connect',
  'Reached from the account menu, where the &ldquo;Not set up&rdquo; marker sits. Built this session — the extension&rsquo;s own options page had been telling people to come here for a screen that did not exist.',
  conn_body,
  [
    ('Token', f'{LIVE} <code>POST /auth/extension-token</code>, minted on an explicit click rather than rendered into the page. Shown once; a second click issues a second token.'),
    ('Status', f'{LIVE} <code>GET /me</code> → <code>hasExtensionToken</code> drives the &ldquo;Not set up&rdquo; marker in the menu and the nudge on Today.'),
    ('Bar', f'{LIVE} full bar — this is a settings page, not a mode.'),
    ('Windows', f'{TODO} &ldquo;the hours you chose&rdquo; comes from <code>activeWindows</code>; showing them here would save a trip to onboarding.'),
    ('Pause', f'{TODO} a &ldquo;pause for today&rdquo; switch needs the extension&rsquo;s backoff state (T-030) before it can mean anything.'),
  ]))
