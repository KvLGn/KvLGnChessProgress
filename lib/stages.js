// Этапы плана: проверка data/plan.js и расчёт текущего этапа.
// Один файл для сайта (<script src="lib/stages.js">) и для scripts/update.mjs (через vm) — логика не дублируется.
// Партия: {id, day, date, color, result, acc, blunders, opp, lvl}. План — window.PLAN, история — window.PROGRESS.
(function(root) {
  var DEFAULT_RULE = {games: 5, blocks: 2, wins: 4, medianAcc: 70, lossMinAcc: 55, lossMaxBlunders: 2};
  var LIMITS = {stageName: 50, openingName: 22, master: 12};

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function(x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ---------- проверка plan.js: ошибки (план не использовать) и предупреждения ----------
  // проверка сама не падает ни на каком файле: неожиданная структура — тоже ошибка плана
  function validatePlan(P, progress) {
    try { return checkPlan(P, progress); }
    catch (e) { return {ok: false, errors: ['неверная структура plan.js (' + (e && e.message) + ') — сверь с примером в начале файла'], warnings: []}; }
  }
  var isStr = function(x) { return typeof x === 'string' && x.length > 0; };
  var strList = function(x) { return Array.isArray(x) && x.every(isStr); };
  function checkPlan(P, progress) {
    var err = [], warn = [];
    if (!P || typeof P !== 'object') return {ok: false, errors: ['plan.js не загрузился — скорее всего, ошибка в синтаксисе (лишняя/пропущенная запятая, скобка, кавычка)'], warnings: []};
    if (!Array.isArray(P.stages) || !P.stages.length) err.push('нет списка этапов stages');
    if (!Array.isArray(P.openings)) err.push('нет списка дебютов openings');
    if (P.rule !== undefined && (!P.rule || typeof P.rule !== 'object')) err.push('rule должно быть вида {games: 5, blocks: 2, …}');
    if (err.length) return {ok: false, errors: err, warnings: warn};
    var R = P.rule || {};
    // границы: games/blocks ≥ 1 (иначе расчёт цели зациклится), проценты 0–100, всё — целые числа
    var RANGE = {games: [1, 20], blocks: [1, 10], wins: [0, 20], medianAcc: [0, 100], lossMinAcc: [0, 100], lossMaxBlunders: [0, 50]};
    Object.keys(RANGE).forEach(function(k) {
      if (!P.rule) return;
      var v = R[k], r = RANGE[k];
      if (typeof v !== 'number' || v % 1 || v < r[0] || v > r[1]) err.push('rule.' + k + ' должно быть целым числом от ' + r[0] + ' до ' + r[1]);
    });
    if (P.rule && R.wins > R.games) err.push('rule.wins больше, чем rule.games');
    if (P.rule && R.games * R.blocks > 30) err.push('rule: games × blocks больше 30 — слишком длинная цель');
    if (!P.rule) warn.push('нет правила перехода rule — взято правило по умолчанию');
    if (P.start !== undefined && typeof P.start !== 'string') err.push("start — дата строкой в кавычках, например '26.09.2026'");
    else if (!/^\d\d\.\d\d\.\d{4}$/.test(P.start || '')) warn.push('start: дата начала должна быть вида дд.мм.гггг, например 26.09.2026');
    var ids = {};
    (P.openings || []).forEach(function(o, i) {
      var at = 'дебют ' + (i + 1) + (o && o.name ? ' («' + o.name + '»)' : '');
      if (!o || !isStr(o.id)) { err.push(at + ': нет id'); return; }
      if (ids[o.id]) err.push(at + ': id «' + o.id + '» повторяется');
      ids[o.id] = true;
      if (!isStr(o.name)) err.push(at + ': нет name');
      else if (o.name.length > LIMITS.openingName) warn.push(at + ': название длиннее ' + LIMITS.openingName + ' символов — может не поместиться на сайте');
      if (o.color !== 'white' && o.color !== 'black') err.push(at + ": color должен быть 'white' или 'black'");
      if (o.color === 'black' && o.vs !== undefined && !isStr(o.vs)) err.push(at + ": vs — первый ход бота строкой, например 'e4'");
      if (o.match !== undefined && !strList(o.match)) err.push(at + ": match — список названий в квадратных скобках, например ['Italian Game']");
      else if (!o.match || !o.match.length) warn.push(at + ': нет match — партии в этом дебюте не будут узнаваться');
      if (o.studies !== undefined && !Array.isArray(o.studies)) { err.push(at + ': studies — список в квадратных скобках [{master: …, id: …}]'); return; }
      (o.studies || []).forEach(function(s) {
        if (!s || typeof s !== 'object' || Array.isArray(s) || !isStr(s.master) || !isStr(s.id)) { err.push(at + ": студия должна быть вида {master: 'Carlsen', id: '…'}"); return; }
        if (s.aka !== undefined && !strList(s.aka)) err.push(at + ": aka — список строк, например ['Kortschnoj']");
        if (s.parts !== undefined && typeof s.parts !== 'number') err.push(at + ': parts студии — число');
        if (!s || !/^[A-Za-z0-9]{8}$/.test(s.id || '')) warn.push(at + ': id студии «' + (s && s.id) + '» не похож на id Lichess (8 букв/цифр)');
        if (s && s.master && s.master.length > LIMITS.master) warn.push(at + ': имя мастера длиннее ' + LIMITS.master + ' символов');
        if (s && s.ids !== undefined) {   // все части студии: список id, первая — та же, что id
          if (!strList(s.ids)) err.push(at + ': ids студии ' + s.master + " — список id в квадратных скобках, например ['nhubKmIC']");
          else if (s.ids.some(function(x) { return !/^[A-Za-z0-9]{8}$/.test(x); })) warn.push(at + ': ids студии ' + s.master + ' — должен быть список id Lichess (по 8 букв/цифр)');
          else if (s.ids[0] !== s.id) warn.push(at + ': первая часть в ids студии ' + s.master + ' должна совпадать с id');
          else if (s.parts && s.ids.length !== s.parts) warn.push(at + ': у студии ' + s.master + ' parts = ' + s.parts + ', а в ids ' + s.ids.length);
        }
      });
    });
    (P.stages || []).forEach(function(S, i) {
      var at = 'этап ' + (i + 1);
      if (!S || !isStr(S.name)) { err.push(at + ': нет name'); return; }
      if (S.openings !== undefined && !strList(S.openings)) { err.push(at + ": openings — список id в квадратных скобках, например ['italian']"); return; }
      if (S.name.length > LIMITS.stageName) warn.push(at + ': название длиннее ' + LIMITS.stageName + ' символов — может не поместиться на сайте');
      if (typeof S.engine !== 'number' || S.engine < 1 || S.engine > 8) err.push(at + ': engine должен быть числом 1–8');
      if (!Array.isArray(S.colors) || !S.colors.length || S.colors.some(function(c) { return c !== 'white' && c !== 'black'; })) err.push(at + ": colors — ['white'], ['black'] или оба");
      (S.openings || []).forEach(function(id) { if (!ids[id]) err.push(at + ': дебют «' + id + '» не найден в openings'); });
    });
    if (err.length) return {ok: false, errors: err, warnings: warn};
    // за чёрных — один дебют на каждый первый ход бота (vs) среди всех, что изучаются одновременно: «Изучаю» = дебюты текущего
    // и всех пройденных этапов; иначе партии, где не получился ни один из двух, не привяжутся к плану (planOpening → maybe)
    var byId = {}, seenVs = {};
    (P.openings || []).forEach(function(o) { if (o && o.id) byId[o.id] = o; });
    (P.stages || []).forEach(function(S, i) {
      ((S && S.openings) || []).forEach(function(id) {
        var o = byId[id]; if (!o || o.color !== 'black' || !o.vs) return;
        if (seenVs[o.vs] && seenVs[o.vs] !== id) warn.push('этап ' + (i + 1) + ': за чёрных против ' + o.vs + ' изучались бы сразу два дебюта («' + seenVs[o.vs] + '» и «' + id + '») — партии, где не получился ни один, не привяжутся к плану');
        else seenVs[o.vs] = id;
      });
    });
    // выполненные этапы (data/progress.js) должны остаться на своих местах
    ((progress && progress.stages) || []).forEach(function(r) {
      var S = (P.stages || [])[r.idx];
      if (!S) err.push('этап ' + (r.idx + 1) + ' уже выполнен ' + r.date + ', но его нет в plan.js — выполненные этапы не удалять');
      else if (S.name !== r.name) warn.push('этап ' + (r.idx + 1) + ' выполнен как «' + r.name + '», а в plan.js сейчас «' + S.name + '» — выполненные этапы не переставлять');
    });
    return {ok: !err.length, errors: err, warnings: warn};
  }

  // ---------- расчёт этапов ----------
  function makeRule(P) { var R = {}, k; for (k in DEFAULT_RULE) R[k] = (P.rule && typeof P.rule[k] === 'number') ? P.rule[k] : DEFAULT_RULE[k]; return R; }
  function honestLoss(g, R) { return g.result === 'win' || (g.acc >= R.lossMinAcc && g.blunders <= R.lossMaxBlunders); }
  function blockCheck(list, R) {
    var wins = list.filter(function(g) { return g.result === 'win'; }).length;
    var med = median(list.map(function(g) { return g.acc; }));
    var bad = list.filter(function(g) { return !honestLoss(g, R); });
    var full = list.length === R.games;
    return {games: list, full: full, wins: wins, med: med, bad: bad, ok: full && wins >= R.wins && med >= R.medianAcc && !bad.length};
  }
  function splitBlocks(rel, R) {
    var tail = rel.slice(-R.blocks * R.games), out = [];
    for (var b = 0; b < R.blocks; b++) out.push(blockCheck(tail.slice(b * R.games, (b + 1) * R.games), R));
    return out;
  }
  function stageGame(S, c) { return function(g) { return g.opp === 'ai' && g.lvl === S.engine && g.color === c; }; }

  // выполненные этапы из progress берутся как есть (правка правила/плана не пересчитывает прошлое);
  // остальное считается по партиям после последнего выполненного этапа
  function evalStages(games, P, progress) {
    var R = makeRule(P), hist = [], from = 0, k = 0;
    var rec = ((progress && progress.stages) || []).slice().sort(function(a, b) { return a.idx - b.idx; });
    for (; k < rec.length && rec[k].idx === k && k < P.stages.length; k++) {
      var r = rec[k], at = -1;
      for (var i = games.length - 1; i >= 0; i--) if (games[i].id === r.game) { at = i; break; }
      if (at < 0) for (i = games.length - 1; i >= 0; i--) if (games[i].day <= r.day) { at = i; break; }
      hist.push({idx: k, name: r.name, date: r.date, day: r.day, game: r.game, recorded: true});
      from = Math.max(from, at + 1);
    }
    for (; k < P.stages.length; k++) {
      var S = P.stages[k], colors = {}, all = true, last = -1;
      S.colors.forEach(function(c) {
        var rel = [], atc = -1, isC = stageGame(S, c);
        for (var j = from; j < games.length; j++) {
          if (!isC(games[j])) continue;
          rel.push(games[j]);
          if (atc < 0 && rel.length >= R.blocks * R.games && splitBlocks(rel, R).every(function(b) { return b.ok; })) atc = j;
        }
        colors[c] = {color: c, done: atc >= 0, doneGame: atc >= 0 ? games[atc] : null, rel: atc >= 0 ? rel.slice(0, rel.indexOf(games[atc]) + 1) : rel};
        colors[c].blocks = splitBlocks(colors[c].rel, R);
        if (atc < 0) all = false; else last = Math.max(last, atc);
      });
      if (!all) return {idx: k, stage: S, from: from, colors: S.colors.map(function(c) { return colors[c]; }), hist: hist, rule: R};
      hist.push({idx: k, name: S.name, date: games[last].date, day: games[last].day, game: games[last].id, recorded: false});
      from = last + 1;
    }
    return {idx: P.stages.length, stage: null, from: from, colors: [], hist: hist, rule: R};
  }

  root.STAGES = {validatePlan: validatePlan, evalStages: evalStages, makeRule: makeRule, honestLoss: honestLoss,
                 blockCheck: blockCheck, splitBlocks: splitBlocks, median: median, DEFAULT_RULE: DEFAULT_RULE, LIMITS: LIMITS};
})(typeof window !== 'undefined' ? window : globalThis);
