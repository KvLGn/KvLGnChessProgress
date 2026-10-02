// Загружает партии и задачи KvLGn с Lichess и обновляет:
//   progress/data/games.js    — партии с анализом + рейтинговые партии
//   progress/data/puzzles.js  — задачи, история рейтинга, темы, режимы (микс / дебют / тема)
//   claude/game-log.md        — лог партий со средними (перезаписывается целиком)
//   claude/puzzle-rating.md   — таблицы задач (ручные разделы сохраняются)
// Запуск: двойной клик по progress/update.bat или `node progress/scripts/update.mjs`.
// Токен читается из claude/.lichess-token. Кэш дебютов — scripts/cache/.
// Подробности и форматы данных — progress/README.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyBlunders } from './blunders.mjs';
import { studyTrees, mastersForGames } from './masters.mjs';
import { loadPlanState, saveGoodPlan, PROGRESS_JS } from './plan-check.mjs';
const { Chess } = await import('chess.js');   // позиции партий — для типов зевков

const USER = 'KvLGn';
const TZ = 'Europe/Moscow';
const DAY_CUTOFF_HOUR = 0;   // день — календарный, от полуночи по Москве (до 02.10.2026 было 5: ночные партии шли в предыдущий день)
const AVG_EVERY = 10;        // средние в логе — каждые 10 партий секции

const HERE = dirname(fileURLToPath(import.meta.url));
const PROGRESS = join(HERE, '..');   // progress/
const ROOT = join(PROGRESS, '..');   // Chess/
const DATA = join(PROGRESS, 'data');
const TOKEN_FILE = join(ROOT, 'claude', '.lichess-token');
const GAMES_JS = join(DATA, 'games.js');
const GAME_LOG = join(ROOT, 'claude', 'game-log.md');

const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd', 'insufficientMaterialClaim']);

/* ---------- helpers ---------- */

function fail(msg) {
  console.error('\nОШИБКА: ' + msg);
  process.exit(1);
}

// токен: из переменной окружения LICHESS_TOKEN (GitHub Actions) или из файла claude/.lichess-token (ПК)
function readToken() {
  if (process.env.LICHESS_TOKEN) return process.env.LICHESS_TOKEN.trim();
  if (!existsSync(TOKEN_FILE)) fail('нет файла с токеном: ' + TOKEN_FILE);
  const token = readFileSync(TOKEN_FILE, 'utf8').replace(/^﻿/, '').trim();
  if (!token.startsWith('lip_')) fail('в ' + TOKEN_FILE + ' не похоже на токен Lichess (должен начинаться с lip_)');
  return token;
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const stampFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// день партии / задачи: дата по Москве (сдвиг DAY_CUTOFF_HOUR — 0, календарный день)
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
function gameDay(ts) {
  const [d, m, y] = dayFmt.format(new Date(ts - DAY_CUTOFF_HOUR * 3600e3)).split('.');
  return { date: `${d}.${m}`, day: `${y}-${m}-${d}` };
}

const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const f1 = (v) => v === null ? '—' : v.toFixed(1);

/* ---------- Lichess ---------- */

async function fetchGames(token) {
  const url = `https://lichess.org/api/games/user/${USER}?accuracy=true&division=true&opening=true&moves=true&evals=true&sort=dateAsc`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/x-ndjson' } });
  if (res.status === 401) fail('Lichess не принял токен (401). Возможно, он удалён — создай новый.');
  if (!res.ok) fail(`Lichess ответил ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function convert(g) {
  const meColor = g.players.white.user?.id === USER.toLowerCase() ? 'white' : 'black';
  const me = g.players[meColor];
  const opp = g.players[meColor === 'white' ? 'black' : 'white'];
  const a = me.analysis;

  const engine = opp.aiLevel
    ? `Stockfish ${opp.aiLevel}`
    : (opp.user?.name || 'Аноним') + (opp.rating ? ` (${opp.rating})` : '');
  const result = !g.winner ? 'draw' : g.winner === meColor ? 'win' : 'lose';
  const plies = g.moves ? g.moves.split(' ').length : 0;

  const out = {
    id: g.id,
    ...gameDay(g.createdAt),
    opening: g.opening?.name || '—',
    eco: g.opening?.eco || '',
    color: meColor,
    result,
    moves: Math.ceil(plies / 2),
    acc: a.accuracy,
    debut: a.phases.opening,
    mid: a.phases.middlegame ?? null,
    end: a.phases.endgame ?? null,
    inacc: a.inaccuracy,
    mistakes: a.mistake,
    blunders: a.blunder,
    acpl: a.acpl,
    engine,
    section: opp.aiLevel ? engine : 'Люди',
    // режим партии — для фильтров «как на Lichess»
    opp: opp.aiLevel ? 'ai' : 'human',             // компьютер / человек
    lvl: opp.aiLevel || null,                      // уровень Stockfish 1–8
    rated: !!g.rated,                              // рейтинговая / товарищеская
    speed: g.speed,                                // ultraBullet | bullet | blitz | rapid | classical | correspondence
    first: g.moves ? g.moves.split(' ')[0] : '',   // первый ход белых — по нему дашборд понимает, какой дебют из плана играл (1.e4 / 1.d4)
  };
  if (typeof me.ratingDiff === 'number') out.ir = me.ratingDiff;
  // зевки по типам: {m: ход, s: сыгранный, t: тип, p: фаза, b: лучший, x: фигура, q: поле, d: потеря в пешках}
  if (g.analysis) out.bl = classifyBlunders(Chess, g, meColor, g.division);
  // для «отчёта о матче»: начало (МСК), длительность, чем закончилась, границы фаз, перевес по ходам
  out.start = timeFmt.format(new Date(g.createdAt));
  if (g.lastMoveAt) out.dur = Math.round((g.lastMoveAt - g.createdAt) / 1000);
  out.ts = g.lastMoveAt || g.createdAt;   // конец партии (мс UTC) — «!» на кнопке «Анализ» первые сутки после партии с зевками / матом
  out.how = g.status;
  out.plies = plies;
  out.mv = g.moves || '';   // ходы партии (SAN) — подписи при наведении на график перевеса
  if (g.division) out.div = { mid: g.division.middle || null, end: g.division.end || null };
  if (g.analysis) {
    const sign = meColor === 'white' ? 1 : -1;
    // перевес с моей стороны после каждого полухода, в десятых пешки, мат = ±100, обрезано до ±100
    out.ev = [2].concat(g.analysis.map((e) => typeof e.mate === 'number' ? sign * Math.sign(e.mate) * 100
      : Math.max(-100, Math.min(100, Math.round(sign * (e.eval || 0) / 10)))));
    // мат в N после полухода (ключ — номер полухода; > 0 — мат у меня, < 0 — у соперника); только где движок видит мат
    const mt = {};
    g.analysis.forEach((e, i) => { if (typeof e.mate === 'number') mt[i + 1] = sign * e.mate; });
    if (Object.keys(mt).length) out.mt = mt;
    // оценки ходов обеих сторон: [полуход, 'I' | 'M' | 'B' (неточность / ошибка / зевок), лучшая линия — до 8 полуходов SAN]
    out.jd = g.analysis.map((e, i) => e.judgment
      ? [i + 1, e.judgment.name[0], (e.variation || '').split(' ').filter(Boolean).slice(0, 8).join(' ')] : null).filter(Boolean);
  }
  return out;
}

/* ---------- games.js ---------- */

function previousIds() {
  if (!existsSync(GAMES_JS)) return new Set();
  const text = readFileSync(GAMES_JS, 'utf8').split('window.RATING_GAMES')[0];   // только партии с анализом, без рейтинговых
  return new Set([...text.matchAll(/"id":"([A-Za-z0-9]{8})"/g)].map((m) => m[1]));
}

function writeGamesJs(games, ratings, stamp) {
  const rows = (list) => list.map((x) => '  ' + JSON.stringify(x)).join(',\n');
  writeFileSync(GAMES_JS,
    '// Создаётся автоматически скриптом update.mjs — не редактировать вручную.\n' +
    `window.GAMES_UPDATED = '${stamp}';\n` +
    'window.GAMES = [\n' + rows(games) + '\n];\n' +
    '// рейтинговые партии для ELO на дашборде (анализ не обязателен)\n' +
    'window.RATING_GAMES = [\n' + rows(ratings) + '\n];\n');
}

/* ---------- progress.js: выполненные этапы плана (расчёт — тот же lib/stages.js, что на сайте) ---------- */

function updateProgress(games, st) {
  const { S, plan, progress } = st;
  if (!st.check.ok) {
    console.log('  ! data/plan.js с ошибкой — этапы не обновлены:');
    st.check.errors.forEach((e) => console.log('    - ' + e));
    return;
  }
  // progress.js не прочитался — не перезаписываем, иначе пропадут записанные этапы
  if (!st.progressOk) { console.log('  ! data/progress.js не прочитался — этапы не обновлены'); return; }
  const cur = S.evalStages(games, plan, progress);
  const fresh = cur.hist.filter((h) => !h.recorded);
  if (!fresh.length) return;
  const stages = progress.stages.concat(fresh.map((h) => ({ idx: h.idx, name: h.name, date: h.date + '.' + h.day.slice(0, 4), day: h.day, game: h.game })));
  writeFileSync(PROGRESS_JS,
    '// Создаётся автоматически скриптом update.mjs — не редактировать вручную.\n' +
    '// Выполненные этапы плана: записываются один раз и больше не пересчитываются,\n' +
    '// чтобы правка правила или plan.js не «откатила» пройденное.\n' +
    'window.PROGRESS = {\n  stages: [\n' + stages.map((x) => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]\n};\n');
  fresh.forEach((h) => console.log(`  ✓ Этап ${h.idx + 1} выполнен ${h.date}: ${h.name}`));
}

/* ---------- game-log.md ---------- */

const RESULT_RU = { win: 'Победа', lose: 'Поражение', draw: 'Ничья' };
const COLOR_RU = { white: 'Белые', black: 'Чёрные' };

function averagesBlock(list, from, to) {
  const w = list.filter((g) => g.result === 'win').length;
  const l = list.filter((g) => g.result === 'lose').length;
  const d = list.length - w - l;
  const ends = list.filter((g) => g.end !== null);
  const mids = list.filter((g) => g.mid !== null);
  const pct = (v) => v === null ? '—' : f1(v) + '%';
  return [
    `### Средние за игры ${from}-${to}`,
    '| Показатель | Среднее |',
    '|---|---|',
    `| Результат | ${w}W / ${l}L${d ? ` / ${d}D` : ''} (${Math.round(w / list.length * 100)}%) |`,
    `| Точность | ${pct(avg(list.map((g) => g.acc)))} |`,
    `| Дебют | ${pct(avg(list.map((g) => g.debut)))} |`,
    `| Миттельшпиль | ${pct(avg(mids.map((g) => g.mid)))} |`,
    `| Эндшпиль | ${pct(avg(ends.map((g) => g.end)))} (${ends.length} из ${list.length} игр) |`,
    `| Неточности | ${f1(avg(list.map((g) => g.inacc)))} |`,
    `| Ошибки | ${f1(avg(list.map((g) => g.mistakes)))} |`,
    `| Зевки | ${f1(avg(list.map((g) => g.blunders)))} |`,
  ].join('\n');
}

function writeGameLog(games, pending, stamp) {
  // секции: соперник + цвет, в порядке появления
  const sections = [];
  const byKey = new Map();
  games.forEach((g, i) => {
    const key = `${g.section} — ${COLOR_RU[g.color]}`;
    if (!byKey.has(key)) { byKey.set(key, { key, color: g.color, games: [] }); sections.push(byKey.get(key)); }
    byKey.get(key).games.push({ ...g, n: i + 1 });
  });
  // секция закрыта, если позже началась другая секция того же цвета (переход на новый уровень)
  sections.forEach((s, i) => { s.closed = sections.slice(i + 1).some((t) => t.color === s.color); });

  const out = [
    '# Лог партий',
    '',
    `> Создаётся автоматически скриптом \`progress/scripts/update.mjs\` из Lichess — не редактировать вручную. Обновлено: ${stamp}.`,
    '',
    '## Правила ведения',
    '- Новая секция для каждой комбинации соперник + цвет (например: Stockfish 3 — Белые, Stockfish 3 — Чёрные, Stockfish 4 — Белые)',
    '- Средние считаются отдельно по каждой секции',
    `- Средние записываются каждые ${AVG_EVERY} партий внутри секции, и при закрытии секции (переход на следующий уровень)`,
    '- Дата — календарный день по Москве (от полуночи до полуночи)',
    '- \\# — сквозной номер партии (как на дашборде)',
  ];

  for (const s of sections) {
    out.push('', `## ${s.key}${s.closed ? ' (закрыта)' : ''}`, '',
      '| # | Дата | Дебют | Результат | Ходы | Точн. | Дебют | Миттельшп. | Эндшп. | Неточн. | Ошиб. | Зевки | Партия |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    s.games.forEach((g) => {
      const pct = (v) => v === null ? '—' : v + '%';
      out.push(`| ${g.n} | ${g.date} | ${g.opening} | ${RESULT_RU[g.result]} | ${g.moves} | ${pct(g.acc)} | ${pct(g.debut)} | ${pct(g.mid)} | ${pct(g.end)} | ${g.inacc} | ${g.mistakes} | ${g.blunders} | [${g.id}](https://lichess.org/${g.id}) |`);
    });
    for (let from = 0; from < s.games.length; from += AVG_EVERY) {
      const chunk = s.games.slice(from, from + AVG_EVERY);
      if (chunk.length === AVG_EVERY || s.closed) out.push('', averagesBlock(chunk, from + 1, from + chunk.length));
    }
  }

  if (pending.length) {
    out.push('', '## Ждут компьютерного анализа', '',
      'Эти партии не попали в лог: на Lichess для них ещё не запрошен компьютерный анализ.', '');
    pending.forEach((p) => out.push(`- ${p.date} — ${p.opening} — [${p.id}](https://lichess.org/${p.id})`));
  }

  writeFileSync(GAME_LOG, out.join('\n') + '\n');
}

/* ---------- задачи: puzzles.js + claude/puzzle-rating.md ---------- */

const PUZZLES_JS = join(DATA, 'puzzles.js');
const PUZZLE_MD = join(ROOT, 'claude', 'puzzle-rating.md');
const YEAR = new Date().getFullYear();

async function api(path, token) {
  const res = await fetch('https://lichess.org' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) fail(`Lichess ответил ${res.status} на ${path}`);
  return res;
}

// все попытки задач, постранично (новые сначала)
async function fetchPuzzleActivity(token) {
  const all = [];
  let before = '';
  for (;;) {
    const text = await (await api(`/api/puzzle/activity?max=200${before}`, token)).text();
    const page = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    all.push(...page);
    if (page.length < 200) break;
    before = '&before=' + page[page.length - 1].date;
  }
  return all.reverse();   // старые сначала
}

// история рейтинга копится снимками: Lichess не хранит историю рейтинга задач
function previousPuzzleHistory() {
  if (existsSync(PUZZLES_JS)) {
    const m = readFileSync(PUZZLES_JS, 'utf8').match(/"history":(\[[^\]]*\])/);
    if (m) return JSON.parse(m[1]);
  }
  // первый запуск — ранние точки из ручной таблицы (колонка «Микс»)
  if (!existsSync(PUZZLE_MD)) return [];
  const md = readFileSync(PUZZLE_MD, 'utf8');
  const i = md.indexOf('## Задачи Lichess'), j = md.indexOf('\n## ', i + 3);
  if (i < 0) return [];
  return [...md.slice(i, j < 0 ? undefined : j).matchAll(/^\| (\d\d)\.(\d\d) \| (\d{3,4}) \|/gm)]
    .map((m) => ({ day: `${YEAR}-${m[2]}-${m[1]}`, date: `${m[1]}.${m[2]}`, rating: +m[3] }));
}

/* --- дебют задачи: по партии-источнику и базе названий Lichess (с учётом перестановок ходов) --- */

const CACHE_DIR = join(HERE, 'cache');
const OPENINGS_CACHE = join(CACHE_DIR, 'openings.json');          // позиция → название дебюта
const PUZZLE_OPENINGS_CACHE = join(CACHE_DIR, 'puzzle-openings.json'); // id задачи → дебют
const MIN_RUN = 6;   // столько задач подряд из одного дебюта = тренировка по дебюту (в миксе 4 подряд Queen's Pawn Game — бывает)

const posKey = (fen) => fen.split(' ').slice(0, 3).join(' ');   // доска + очередь хода + рокировки

async function loadOpenings(Chess) {
  if (existsSync(OPENINGS_CACHE)) return JSON.parse(readFileSync(OPENINGS_CACHE, 'utf8'));
  console.log('  скачиваю базу названий дебютов Lichess (один раз)...');
  const map = {};
  for (const f of ['a', 'b', 'c', 'd', 'e']) {
    const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${f}.tsv`);
    if (!res.ok) fail('не удалось скачать базу дебютов: ' + res.status);
    for (const line of (await res.text()).split('\n').slice(1)) {
      const [eco, name, pgn] = line.split('\t');
      if (!pgn) continue;
      const c = new Chess();
      try { c.loadPgn(pgn); } catch { continue; }
      map[posKey(c.fen())] = { eco, name };
    }
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(OPENINGS_CACHE, JSON.stringify(map));
  return map;
}

// самая глубокая известная позиция в партии — как это делает Lichess
function detectOpening(Chess, openings, san) {
  const c = new Chess();
  let found = null;
  for (const mv of san.split(' ')) {
    try { c.move(mv); } catch { break; }
    const hit = openings[posKey(c.fen())];
    if (hit) found = hit;
  }
  return found ? found.name : null;
}

async function puzzleOpenings(ids, token) {
  const openings = await loadOpenings(Chess);
  const cache = existsSync(PUZZLE_OPENINGS_CACHE) ? JSON.parse(readFileSync(PUZZLE_OPENINGS_CACHE, 'utf8')) : {};
  const todo = [...new Set(ids)].filter((id) => !(id in cache));
  if (todo.length) console.log(`  определяю дебюты новых задач: ${todo.length}...`);
  for (const id of todo) {
    let res = await fetch('https://lichess.org/api/puzzle/' + id, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 429) { console.log('  Lichess просит подождать минуту...'); await new Promise((r) => setTimeout(r, 61000)); res = await fetch('https://lichess.org/api/puzzle/' + id); }
    if (!res.ok) { cache[id] = null; continue; }
    const j = await res.json();
    cache[id] = detectOpening(Chess, openings, j.game.pgn);
    await new Promise((r) => setTimeout(r, 250));   // бережём лимиты API
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(PUZZLE_OPENINGS_CACHE, JSON.stringify(cache, null, 0));
  return cache;
}

// тренировка по дебюту = серия из MIN_RUN+ задач подряд одного семейства дебютов
function markModes(attempts) {
  const fam = (a) => (a.op || '').split(':')[0] || null;
  let i = 0;
  while (i < attempts.length) {
    let j = i;
    while (j + 1 < attempts.length && fam(attempts[j + 1]) && fam(attempts[j + 1]) === fam(attempts[i])) j++;
    const run = attempts.slice(i, j + 1);
    if (fam(attempts[i]) && run.length >= MIN_RUN) {
      // подпись: «дебют: вариант», если он у большинства задач серии, иначе семейство
      const cnt = {};
      run.forEach((a) => { const k = a.op.split(',')[0]; cnt[k] = (cnt[k] || 0) + 1; });
      const [top, n] = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
      const label = n / run.length >= 0.6 ? top : fam(attempts[i]);
      run.forEach((a) => { a.mode = 'open'; a.tr = label; });
    } else run.forEach((a) => { a.mode = 'mix'; });
    i = j + 1;
  }
  markThemeRuns(attempts);
}

// тренировка по теме = MIN_RUN+ задач подряд (не из дебютной серии) с общей тактической темой
const GENERIC_THEMES = new Set(['middlegame', 'endgame', 'opening', 'short', 'long', 'veryLong', 'oneMove',
  'advantage', 'crushing', 'equality', 'master', 'masterVsMaster', 'superGM', 'mate']);
function markThemeRuns(attempts) {
  const tactical = (a) => (a.themes || []).filter((t) => !GENERIC_THEMES.has(t));
  let i = 0;
  while (i < attempts.length) {
    if (attempts[i].mode !== 'mix') { i++; continue; }
    let common = tactical(attempts[i]);
    let j = i;
    while (j + 1 < attempts.length && attempts[j + 1].mode === 'mix') {
      const next = common.filter((t) => tactical(attempts[j + 1]).includes(t));
      if (!next.length) break;
      common = next;
      j++;
    }
    if (j - i + 1 >= MIN_RUN && common.length) {
      attempts.slice(i, j + 1).forEach((a) => { a.mode = 'theme'; a.tr = common[0]; });
      i = j + 1;
    } else i++;
  }
}

function perf(list) {
  if (!list.length) return null;
  const w = list.filter((a) => a.win).length;
  return Math.round(list.reduce((s, a) => s + a.r, 0) / list.length + 400 * (2 * w - list.length) / list.length);
}

function buildPuzzles(user, activity, opCache) {
  const rating = user.perfs?.puzzle?.rating ?? null;
  const today = gameDay(Date.now());
  const history = previousPuzzleHistory().filter((h) => h.day !== today.day);
  if (rating !== null) history.push({ ...today, rating });
  history.sort((a, b) => a.day.localeCompare(b.day));

  // win у Lichess = задача в итоге решена (в т.ч. со второй попытки)
  const attempts = activity.map((a) => ({ ...gameDay(a.date), id: a.puzzle.id, win: a.win, r: a.puzzle.rating, themes: a.puzzle.themes, op: opCache[a.puzzle.id] || null }));
  markModes(attempts);
  return { rating, total: attempts.length, history, attempts };
}

function writePuzzlesJs(p, stamp) {
  writeFileSync(PUZZLES_JS,
    '// Создаётся автоматически скриптом update.mjs — не редактировать вручную.\n' +
    `window.PUZZLES_UPDATED = '${stamp}';\n` +
    'window.PUZZLES = {"rating":' + JSON.stringify(p.rating) + ',"total":' + p.total +
    ',"history":' + JSON.stringify(p.history) + ',\n"themeNames":' + JSON.stringify(p.themeNames || {}) +
    ',\n"themeStats":' + JSON.stringify(p.themeStats || {}) + ',\n"global":' + JSON.stringify(p.global || null) + ',\n"attempts":[\n' +
    p.attempts.map((a) => '  ' + JSON.stringify(a)).join(',\n') + '\n]};\n');
}

// по дням: строка «Микс» и по строке на каждую дебютную тренировку
function modeRows(attempts, names = {}) {
  const groups = new Map();
  const label = (a) => a.mode === 'open' ? a.tr : a.mode === 'theme' ? 'Тема: ' + (names[a.tr] || a.tr) : 'Микс';
  attempts.forEach((a) => {
    const key = a.day + '|' + (a.mode === 'mix' ? '' : a.mode + a.tr);
    if (!groups.has(key)) groups.set(key, { date: a.date, day: a.day, label: label(a), list: [] });
    groups.get(key).list.push(a);
  });
  return [...groups.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || (a.label === 'Микс' ? -1 : 1))
    .map((g) => {
      const w = g.list.filter((a) => a.win).length;
      return `| ${g.date} | ${g.label} | ${g.list.length} | ${Math.round(w / g.list.length * 100)}% | ${perf(g.list)} |`;
    });
}

// таблица по дням пишется заново, ручные разделы (дебютные задачи, Duolingo) сохраняются
function writePuzzleMd(p, stamp) {
  const old = existsSync(PUZZLE_MD) ? readFileSync(PUZZLE_MD, 'utf8') : '';
  const section = (title) => {
    const i = old.indexOf('## ' + title);
    if (i < 0) return null;
    const j = old.indexOf('\n## ', i + 3);
    return old.slice(i, j < 0 ? undefined : j).trim();
  };

  let manual = section('Дебютные задачи (вручную)');
  if (!manual) {
    // миграция старой таблицы: колонки «Дебютные (…)» уходят в ручной раздел
    const head = old.match(/^\| Дата \| Микс \|(.*)\|$/m);
    const cols = head ? head[1].split('|').map((c) => c.trim()).filter(Boolean) : [];
    const rows = [...old.matchAll(/^\| (\d\d\.\d\d) \| \d{3,4} \|(.*)\|$/gm)]
      .map((m) => [m[1], ...m[2].split('|').map((c) => c.trim())])
      .filter((r) => r.slice(1).some((c) => c && c !== '—'));
    manual = '## Дебютные задачи (вручную)\n\n' + (cols.length
      ? `| Дата | ${cols.join(' | ')} |\n|${'---|'.repeat(cols.length + 1)}\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n')
      : '_Пока пусто._');
  }
  const duolingo = section('Duolingo Chess') || '## Duolingo Chess\n\n_Пока пусто._';

  const byDay = new Map();
  p.history.forEach((h) => byDay.set(h.day, { date: h.date, rating: h.rating, n: 0, win: 0 }));
  p.attempts.forEach((a) => {
    if (!byDay.has(a.day)) byDay.set(a.day, { date: a.date, rating: null, n: 0, win: 0 });
    const d = byDay.get(a.day);
    d.n++;
    if (a.win) d.win++;
  });
  const rows = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, d]) =>
    `| ${d.date} | ${d.rating ?? '—'} | ${d.n || '—'} | ${d.n ? Math.round(d.win / d.n * 100) + '%' : '—'} |`);

  writeFileSync(PUZZLE_MD, [
    '# Рейтинг задач и рейтинги',
    '',
    `> Раздел «Задачи Lichess» создаётся автоматически скриптом \`progress/scripts/update.mjs\`. Обновлено: ${stamp}.`,
    '> Рейтинг — снимок на момент запуска скрипта (Lichess не хранит историю рейтинга задач). Остальные разделы ведутся вручную.',
    '',
    '## Задачи Lichess',
    '',
    '| Дата | Рейтинг | Задач | Решено верно |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Микс и дебютные задачи',
    '',
    `Режим определяется автоматически: ${MIN_RUN}+ задач подряд из одного дебюта — тренировка по дебюту, ${MIN_RUN}+ подряд с общей тактической темой — тренировка по теме, остальное — микс.`,
    'Рейтинг задач у Lichess один на всё, поэтому для сравнения — перфоманс: средний рейтинг задач ± 400 × (решено − не решено) / задач.',
    '',
    '| Дата | Режим | Задач | Решено | Перфоманс |',
    '|---|---|---|---|---|',
    ...modeRows(p.attempts, p.themeNames),
    '',
    manual,
    '',
    duolingo,
    '',
  ].join('\n'));
}

/* ---------- main ---------- */

const token = readToken();
console.log(`Загружаю партии ${USER} с Lichess...`);
const raw = await fetchGames(token);

const games = [];
const ratings = [];
const pending = [];
for (const g of raw) {
  if (g.variant !== 'standard' || !FINISHED.has(g.status)) continue;
  const meColor = g.players.white.user?.id === USER.toLowerCase() ? 'white' : 'black';
  const me = g.players[meColor];
  if (g.rated && typeof me.rating === 'number') {
    const diff = me.ratingDiff ?? 0;
    ratings.push({ id: g.id, ...gameDay(g.createdAt), perf: g.perf, before: me.rating, diff, after: me.rating + diff });
  }
  if (!me.analysis?.phases) {
    pending.push({ id: g.id, ...gameDay(g.createdAt), opening: g.opening?.name || '—' });
    continue;
  }
  games.push(convert(g));
}

// план: если plan.js сломан — последняя рабочая копия (data/plan-good.js), чтобы не пропали «Мастера»
const planState = loadPlanState();
const plan = planState.check.ok ? planState.plan : planState.good?.plan;
if (!planState.check.ok) console.log('  ! data/plan.js с ошибкой — беру последнюю рабочую копию плана' + (planState.good ? ` (от ${planState.good.at})` : ' (её нет)'));

// «Мастера»: что играли мастера в позициях моих партий — студии из плана и база мастеров Lichess (поле ms)
if (plan) {
  console.log('Сверяю ходы с мастерами...');
  const trees = await studyTrees(Chess, plan, join(CACHE_DIR, 'study-trees.json'), console.log);
  await mastersForGames(Chess, games, plan, trees, token, join(CACHE_DIR, 'masters.json'), console.log);
}

const before = previousIds();
const added = games.filter((g) => !before.has(g.id));
const stamp = stampFmt.format(new Date()).replace(',', '');

console.log('Загружаю задачи...');
const puzzleUser = await (await api(`/api/user/${USER}`, token)).json();
const activity = await fetchPuzzleActivity(token);
const opCache = await puzzleOpenings(activity.map((a) => a.puzzle.id), token);
const puzzles = buildPuzzles(puzzleUser, activity, opCache);
// русские названия тем — из сводки Lichess (язык аккаунта)
const dash = await (await api('/api/puzzle/dashboard/90', token)).json();
puzzles.themeNames = Object.fromEntries(Object.entries(dash.themes || {}).map(([k, v]) => [k, v.theme]));
// по темам — перфоманс самого Lichess (только решения с первой попытки, за 90 дней): точнее, чем по истории задач
puzzles.themeStats = Object.fromEntries(Object.entries(dash.themes || {}).map(([k, v]) =>
  [k, { nb: v.results.nb, first: v.results.firstWins, perf: v.results.performance }]));
puzzles.global = dash.global ? { nb: dash.global.nb, first: dash.global.firstWins, perf: dash.global.performance } : null;

// защита от сбоя Lichess — до любой записи: партий или задач стало заметно меньше (больше 10% или до нуля) — ничего не пишем.
// Небольшое уменьшение (например, у партии пропал анализ) — только предупреждение, иначе обновление падало бы каждый раз
function shrinkGuard(what, now, was) {
  if (now >= was) return;
  if (now === 0 || now < was * 0.9) fail(`Lichess вернул ${now} ${what}, а было ${was} — похоже на сбой; данные не изменены (следующий запуск попробует снова).`);
  console.log(`  ! ${what}: было ${was}, стало ${now} — небольшое уменьшение, данные обновлены`);
}
const puzzlesBefore = existsSync(PUZZLES_JS) ? +((readFileSync(PUZZLES_JS, 'utf8').match(/"total":(\d+)/) || [])[1] || 0) : 0;
shrinkGuard('партий с анализом', games.length, before.size);
shrinkGuard('задач', puzzles.total, puzzlesBefore);

writeGamesJs(games, ratings, stamp);
updateProgress(games, planState);
if (saveGoodPlan(planState, stamp)) console.log('  запасная копия плана обновлена (data/plan-good.js)');
writePuzzlesJs(puzzles, stamp);
// заметки Claude (claude/*.md) есть только на ПК; в облаке их нет — пропускаем
const HAS_NOTES = existsSync(join(ROOT, 'claude'));
if (HAS_NOTES) writeGameLog(games, pending, stamp);
if (HAS_NOTES) writePuzzleMd(puzzles, stamp);

console.log(`\nВсего партий с анализом: ${games.length}`);
if (added.length && before.size) {
  console.log(`Новые (${added.length}):`);
  added.forEach((g) => console.log(`  #${games.indexOf(g) + 1}  ${g.date}  ${RESULT_RU[g.result].padEnd(9)}  ${g.acc}%  ${g.opening}`));
} else if (!added.length) {
  console.log('Новых партий нет.');
}
if (pending.length) {
  console.log(`\nБез компьютерного анализа (${pending.length}) — запроси анализ на Lichess и запусти снова:`);
  pending.forEach((p) => console.log(`  ${p.date}  https://lichess.org/${p.id}  ${p.opening}`));
}
console.log(`\nЗадачи: рейтинг ${puzzles.rating ?? '—'}, попыток ${puzzles.total}`);
console.log('\nОбновлено: progress/data/games.js, progress/data/puzzles.js, claude/game-log.md, claude/puzzle-rating.md');
