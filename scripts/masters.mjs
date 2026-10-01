// «Мастера»: что играли мастера в позициях моих партий (первые MAX_MOVES своих ходов).
// Два источника:
//   студии из plan.js (поле ids — все части; партии мастера только его цветом = цвет дебюта) → «дерево мастера»:
//     позиция → {ход: сколько раз}; дерево кэшируется в cache/study-trees.json и пересобирается раз в сутки или при смене ids;
//   база по ступеням (нужен токен): 'm' — база мастеров Lichess (турнирные партии 2200+); если там меньше MIN_GAMES партий
//     (бот сыграл необычно) — 'l' — игроки Lichess 2000+; меньше и там — 'a' — любители Lichess 1800+ (качество ниже, сайт
//     показывает их серым); ни на одной ступени нет MIN_GAMES — берётся та, где партий больше всего.
//     Ответы кэшируются по позиции в cache/masters.json (CACHE_V — версия правил; сменилась — кэш собирается заново).
// Итог для партии — поле ms: [[p, [всего, [[ход, партий], …], источник 'm' | 'l' | 'a'], {'дебют/мастер': [[ход, раз], …]}], …]
//   (ключ с дебютом: один мастер бывает в студиях разных дебютов — «italian/Carlsen», «ruy/Carlsen»; какой брать, решает сайт по плану),
//   p — полуход позиции перед моим ходом (мой ход — p + 1); база — топ-5 ходов, мастер из студии — все его ходы.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_MOVES = 20;                 // сравниваем первые 20 своих ходов
const MIN_GAMES = 20;                        // меньше партий на ступени — спускаемся на следующую
const CACHE_V = 2;                           // версия правил кэша: 2 — ступени m / l / a
const TIERS = [                              // ступени базы: сначала самые сильные
  ['m', 'masters?'],
  ['l', 'lichess?recentGames=0&speeds=blitz,rapid,classical&ratings=2000,2200,2500&'],
  ['a', 'lichess?recentGames=0&speeds=bullet,blitz,rapid,classical,correspondence&ratings=1800,2000,2200,2500&']
];
const TREE_TTL = 24 * 3600e3;                // дерево студий пересобирается раз в сутки
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');   // доска + очередь хода + рокировки + взятие на проходе

function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function writeJson(file, data) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ходы партии из PGN: без заголовков, комментариев, вариантов, NAG, номеров и результата (loadPgn спотыкается о комментарии студий)
function pgnMoves(text) {
  let body = text.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, ' ');   // варианты, в том числе вложенные
  return body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
    .split(/\s+/).filter(Boolean);
}
const header = (text, name) => ((text.match(new RegExp('^\\[' + name + ' "([^"]*)"\\]', 'm')) || [])[1] || '');
// «Carlsen, M» / «So, W» — фамилия мастера в начале имени (So не спутать с Sokolov)
// aka — другие написания фамилии в студии (Korchnoi / Kortschnoj)
const isMaster = (name, master, aka) => [master].concat(aka || []).some((m) => new RegExp('^' + m.replace(/[^A-Za-z]/g, '') + '(,|\\s|$)', 'i').test(name.trim()));

/* ---------- студии → дерево мастера ---------- */
async function fetchStudy(id) {
  const res = await fetch(`https://lichess.org/api/study/${id}.pgn`);
  if (!res.ok) throw new Error(`студия ${id}: HTTP ${res.status} (открыта ли по ссылке?)`);
  return res.text();
}
// деревья всех мастеров из студий плана: {openingId: {master: {color, games, tree: {posKey: {san: n}}}}}
export async function studyTrees(Chess, plan, cacheFile, log) {
  const cache = readJson(cacheFile, { at: 0, sig: '', trees: {} });
  const want = [];
  (plan.openings || []).forEach((o) => (o.studies || []).forEach((s) => {
    if (Array.isArray(s.ids) && s.ids.length) want.push({ op: o.id, color: o.color, master: s.master, aka: s.aka, ids: s.ids });
  }));
  const sig = JSON.stringify(want);
  if (cache.sig === sig && Date.now() - cache.at < TREE_TTL) return cache.trees;
  const trees = {};
  for (const w of want) {
    const t = { color: w.color, games: 0, tree: {} };
    try {
      for (const id of w.ids) {
        const text = await fetchStudy(id);
        for (const g of text.split(/\r?\n\r?\n(?=\[Event )/)) {
          const side = w.color === 'white' ? 'White' : 'Black';
          if (!isMaster(header(g, side), w.master, w.aka)) continue;   // только партии мастера цветом дебюта
          const c = new Chess();
          let ply = 0;
          for (const san of pgnMoves(g)) {
            if (ply >= MAX_MOVES * 2) break;
            const masterToMove = (ply % 2 === 0) === (w.color === 'white');
            const key = posKey(c.fen());
            let mv;
            try { mv = c.move(san); } catch { break; }
            if (masterToMove) { const node = t.tree[key] = t.tree[key] || {}; node[mv.san] = (node[mv.san] || 0) + 1; }
            ply++;
          }
          t.games++;
        }
        await sleep(300);
      }
      (trees[w.op] = trees[w.op] || {})[w.master] = t;
      log(`  студии: ${w.master} (${w.op}) — ${t.games} партий ${w.color === 'white' ? 'белыми' : 'чёрными'}`);
    } catch (e) {
      log('  ! ' + e.message + ' — дерево прошлое');
      const old = cache.trees[w.op] && cache.trees[w.op][w.master];
      if (old) (trees[w.op] = trees[w.op] || {})[w.master] = old;
    }
  }
  writeJson(cacheFile, { at: Date.now(), sig, trees });
  return trees;
}

/* ---------- база мастеров Lichess ---------- */
// один запрос к базе: [всего партий, [[ход, партий], …топ-5]]; null — не удалось спросить
async function ask(url, token) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 429) { await sleep(61000); continue; }   // Lichess просит подождать минуту
    if (!res.ok) return null;
    const j = await res.json();
    return [j.white + j.draws + j.black, (j.moves || []).map((m) => [m.san, m.white + m.draws + m.black])];
  }
  return null;
}
// позиция: первая ступень, где не меньше MIN_GAMES партий; иначе — где партий больше всего; null — база недоступна
async function explorer(fen, token) {
  const f = encodeURIComponent(fen);
  let best = null;
  for (const [src, path] of TIERS) {
    const r = await ask('https://explorer.lichess.ovh/' + path + 'moves=5&topGames=0&fen=' + f, token);
    if (!r) return best;   // база ответила ошибкой — что успели
    const cur = r.concat(src);
    if (cur[0] >= MIN_GAMES) return cur;
    if (!best || cur[0] > best[0]) best = cur;
    await sleep(250);
  }
  return best;
}

/* ---------- сверка партии ---------- */
// games — партии из update.mjs (color, mv); планы дебютов — какие деревья мастеров смотреть для цвета партии
export async function mastersForGames(Chess, games, plan, trees, token, cacheFile, log) {
  let cache = readJson(cacheFile, {});
  if (cache._v !== CACHE_V) cache = { _v: CACHE_V };   // правила ступеней сменились — спрашиваем заново
  let asked = 0, failed = false;
  for (const g of games) {
    if (!g.mv) continue;
    // студии всех дебютов моего цвета (какой дебют у партии по плану — решает сайт, planOpening)
    const my = (plan.openings || []).filter((o) => o.color === g.color && trees[o.id]).map((o) => [o.id, trees[o.id]]);
    const c = new Chess(), sans = g.mv.split(' ').filter(Boolean), rows = [];
    let mine = 0;
    for (let p = 0; p < sans.length && mine < MAX_MOVES; p++) {
      const myTurn = (p % 2 === 0) === (g.color === 'white');
      if (myTurn) {
        const fen = c.fen(), key = posKey(fen);
        if (!(key in cache) && !failed) {
          const r = await explorer(fen, token);
          asked++;
          if (r) cache[key] = r; else failed = true;   // база недоступна — дальше в этот раз не спрашиваем
          await sleep(250);
        }
        const base = cache[key] || null;
        const byMaster = {};
        my.forEach(([op, mm]) => Object.keys(mm).forEach((name) => {
          const node = mm[name].tree[key];
          if (node) byMaster[op + '/' + name] = Object.entries(node).sort((a, b) => b[1] - a[1]);
        }));
        if ((!base || !base[0]) && !Object.keys(byMaster).length) break;   // позиции нет ни у кого — дальше сравнивать не с чем
        rows.push(Object.keys(byMaster).length ? [p, base, byMaster] : [p, base]);
        mine++;
      }
      try { c.move(sans[p]); } catch { break; }
    }
    if (rows.length) g.ms = rows;
  }
  writeJson(cacheFile, cache);
  if (asked) log(`  база мастеров: новых позиций ${asked}${failed ? ' (база ответила ошибкой — остальные в следующий раз)' : ''}`);
}
