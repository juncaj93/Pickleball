// Zip 79 (🎾79.results skills), part 2: History > Skills (organizer only; pictures skills/04 and 05). Its own request when the tab opens
// (GET /api/admin/skills), never on Home or the 5 second check. Most improved (top 3, last 12 months; hidden when nobody improved), the Levels
// table (sort by Level, Improved or Name; the last 3 tournament dates, each cell green when higher than that player's level before it, orange
// when lower, gray when the same, a dash when they did not play; Current boxed; Change over 12 months), and a tap on a name opens the trend
// sheet (the level big, "+0.7 past 3mo", a chart on the seven levels with the site's pickleball as the last point, then every tournament).
// The math is shared/skills.ts. Names are never cut. Players never see any of it.
import { type CSSProperties, useEffect, useState } from 'react';
import { levelShort } from '../../../shared/tournament';
import {
  CHART_LEVELS,
  changeText,
  type LevelRow,
  levelStep,
  levelsTable,
  mostImproved,
  type SkillsSort,
  skillsDates,
  type SkillsView,
  toneOf,
  trendOf,
} from '../../../shared/skills';
import { api } from '../../lib';
import { Pickleball, Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import './skills-history.css';

const SORTS: { key: SkillsSort; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'improved', label: 'Improved' },
  { key: 'name', label: 'Name' },
];

export function SkillsHistory({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<SkillsView | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SkillsSort>('level');
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<SkillsView>('GET', '/api/admin/skills')
      .then((v) => live && setView(v))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [ctx.d.tournament?.id]);
  if (error) return <p className="muted">Could not load the levels. Pull down to try again.</p>;
  if (!view) return <div className="card skel tm-sk-skel" aria-hidden="true" />;
  const top = mostImproved(view);
  const table = levelsTable(view, sort);
  const person = who ? (view.players.find((p) => p.id === who) ?? null) : null;
  // Zip 93: the columns' dates as "AUG" (the day too when two columns share a month).
  const colDate = skillsDates(table.columns.map((c) => c.date));
  return (
    <div className="stack tm-sk" data-skills>
      {top.length > 0 && (
        <section className="tm-card tm-sk-card" aria-label="Most improved, last 12 months" data-skills-improved>
          <div className="tm-card-head tm-head-line">
            <h3 className="tm-label">Most improved</h3>
            <span className="tm-chip tm-sk-chip">Last 12 months</span>
          </div>
          <ol className="tm-sk-top">
            {top.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="tm-sk-toprow" onClick={() => setWho(r.id)} data-skills-top={r.name}>
                  <span className={`tm-sk-rank${i === 0 ? ' tm-sk-rank1' : ''}`} aria-label={`${i + 1}.`}>
                    {i + 1}
                  </span>
                  <span className="tm-sk-name">{r.name}</span>
                  <span className="tm-sk-fromto">
                    {levelShort(r.from)} <span aria-label="to">→</span> {levelShort(r.to)}
                  </span>
                  <span className="tm-sk-pill tm-sk-up">{changeText(r.change)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="tm-card tm-sk-card tm-sk-levels" aria-label="Levels" data-skills-levels>
        <div className="segmented tm-sk-sort" role="group" aria-label="Sort by">
          {SORTS.map((s) => (
            <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)} data-skills-sort={s.key}>
              {s.label}
            </button>
          ))}
        </div>
        {table.rows.length === 0 ? (
          <p className="tm-sk-empty">No levels yet. They show here once a tournament ends.</p>
        ) : (
          <div className="tm-sk-scroll">
            <table className="tm-sk-table">
              <thead>
                <tr>
                  <th scope="col" className="tm-sk-th-name">
                    Player
                  </th>
                  {table.columns.map((c) => (
                    <th scope="col" key={c.id} className="tm-sk-th-date">
                      {colDate(c.date)}
                    </th>
                  ))}
                  <th scope="col" className="tm-sk-th-now">
                    Current
                  </th>
                  <th scope="col" className="tm-sk-th-chg">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <LevelsRow key={r.id} r={r} onOpen={() => setWho(r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Sheet calmFocus open={!!person} title={person?.name ?? ''} onClose={() => setWho(null)} className="tm-sk-sheet">
        {person && <TrendBody p={person} today={view.today} />}
      </Sheet>
    </div>
  );
}

function LevelsRow({ r, onOpen }: { r: LevelRow; onOpen: () => void }) {
  return (
    <tr data-skills-row={r.name}>
      <th scope="row" className="tm-sk-td-name">
        <button type="button" className="tm-sk-namebtn" onClick={onOpen}>
          {r.name}
        </button>
      </th>
      {r.cells.map((c, i) => (
        <td key={i} className="tm-sk-td">
          {c.level === null ? (
            <span className="tm-sk-dash" aria-label="Did not play">
              –
            </span>
          ) : (
            <span className={`tm-sk-cell tm-sk-${c.tone}`} data-tone={c.tone}>
              {levelShort(c.level)}
            </span>
          )}
        </td>
      ))}
      <td className="tm-sk-td">
        <span className="tm-sk-now">{levelShort(r.current)}</span>
      </td>
      <td className={`tm-sk-td tm-sk-chg tm-sk-t-${toneOf(r.change)}`}>{changeText(r.change)}</td>
    </tr>
  );
}

/** The chart's drawing box (the SVG scales to the sheet's width; the pickleball is placed in % of it). */
const W = 320;
const H = 190;
const LEFT = 40;
const RIGHT = 18;
const TOP = 12;
const BOTTOM = 14;

function TrendBody({ p, today }: { p: SkillsView['players'][number]; today: string }) {
  const tr = trendOf(p, today);
  const n = tr.points.length;
  const steps = CHART_LEVELS.length - 1;
  const x = (i: number) => (n <= 1 ? LEFT + (W - LEFT - RIGHT) / 2 : LEFT + 12 + (i * (W - LEFT - RIGHT - 24)) / (n - 1));
  const y = (v: number) => TOP + ((steps - levelStep(v)) * (H - TOP - BOTTOM)) / steps;
  const pts = tr.points.map((pt, i) => ({ x: x(i), y: y(pt.level), ...pt }));
  // Zip 93: this player's dates as "AUG" ("AUG 3" and "AUG 24" when two of their entries fall in the same month).
  const date = skillsDates(tr.list.map((l) => l.date));
  const last = pts[pts.length - 1];
  return (
    <div className="tm-sk-trend" data-skills-trend={p.name}>
      <div className="tm-sk-big">
        <span className="tm-sk-bignum">{levelShort(tr.current)}</span>
        {tr.pill && (
          <span className={`tm-sk-pill tm-sk-${tr.pill.tone}`} data-skills-pill>
            {tr.pill.text}
          </span>
        )}
      </div>
      <figure className="tm-sk-chart" aria-label={`${p.name}’s level, ${tr.points.map((pt) => `${date(pt.date)} ${levelShort(pt.level)}`).join(', ')}`}>
        <div className="tm-sk-plot" style={{ aspectRatio: `${W} / ${H}` } as CSSProperties}>
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            {CHART_LEVELS.map((l) => (
              <g key={l.value}>
                <line className="tm-sk-grid" x1={LEFT} x2={W - 4} y1={y(l.value)} y2={y(l.value)} />
                <text className="tm-sk-ylab" x={4} y={y(l.value) + 4}>
                  {l.label}
                </text>
              </g>
            ))}
            {pts.length > 1 && <polyline className="tm-sk-line" points={pts.map((q) => `${q.x},${q.y}`).join(' ')} />}
            {pts.slice(0, -1).map((q) => (
              <circle key={q.date} className="tm-sk-dot" cx={q.x} cy={q.y} r={6} />
            ))}
          </svg>
          {last && (
            <span className="tm-sk-ball" style={{ left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%` } as CSSProperties} aria-hidden="true">
              <Pickleball />
            </span>
          )}
        </div>
        <div className="tm-sk-xlabs" aria-hidden="true">
          {pts.map((q, i) =>
            // Up to 5 dates under the chart (the first, the last, evenly between); every date is in the list below.
            i === pts.length - 1 || i % Math.ceil(pts.length / 5) === 0 ? (
              <span key={q.date} style={{ left: `${(q.x / W) * 100}%` } as CSSProperties}>
                {date(q.date)}
              </span>
            ) : null,
          )}
        </div>
      </figure>
      <ul className="tm-sk-list">
        {tr.list.map((l) => (
          <li key={l.date} className="tm-sk-li" data-skills-entry={l.date}>
            <span className="tm-sk-date">{date(l.date)}</span>
            {l.change !== null && l.change !== 0 && <span className={`tm-sk-pill tm-sk-${toneOf(l.change)}`}>{changeText(l.change)}</span>}
            {l.change === 0 && <span className="tm-sk-pill tm-sk-same">same</span>}
            <span className="tm-sk-lvl">{levelShort(l.level)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
