// ============================================================================
//  ПЛАН ОБУЧЕНИЯ — единственный файл, который правится вручную (человеком или ИИ).
//  Всё остальное на сайте считается само из партий и задач Lichess.
//  Как править с помощью ИИ — progress/AI-PROMPT.md (там же лимиты длины и примеры).
//
//  После правки: сохранить файл и отправить на GitHub (update.bat или правка
//  прямо на github.com) — сайт обновится сам через ~1 минуту.
//
//  Где что видно на сайте:
//    stages[].name   — подвал страницы, шапка панели «Итоги», поиск   (до 50 символов)
//    openings[].name — карточка и панель «Дебюты», таблица партий     (до 22 символов)
//    studies.master  — ссылки на студии в панели «Дебюты» и в поиске  (до 12 символов)
//
//  Этапы переключаются САМИ, когда выполнено правило rule для всех цветов этапа.
//  Прошедшие этапы не удалять — по ним сайт считает, когда начался текущий.
// ============================================================================
window.PLAN = {
  start: '26.09.2026',   // дата начала занятий (дд.мм.гггг)

  // Правило перехода на следующий этап (для каждого цвета этапа отдельно):
  // последние blocks × games партий этим цветом против бота этапа, сыгранные ПОСЛЕ
  // начала этапа, делятся на blocks пятёрок; в КАЖДОЙ пятёрке:
  //   • побед не меньше wins;
  //   • медиана точности всех партий пятёрки ≥ medianAcc;
  //   • каждая невыигранная партия «честная»: точность ≥ lossMinAcc и зевков ≤ lossMaxBlunders.
  rule: {games: 5, blocks: 2, wins: 4, medianAcc: 70, lossMinAcc: 55, lossMaxBlunders: 2},

  // Этапы по порядку. engine — уровень Stockfish, colors — какими цветами нужно выполнить правило,
  // openings — id дебютов, которые на этом этапе начинают изучаться (см. openings ниже).
  stages: [
    {name: 'Итальянская за белых vs Stockfish 3',          engine: 3, colors: ['white'],          openings: ['italian']},
    {name: 'Сицилианская и Славянская vs Stockfish 3',     engine: 3, colors: ['white', 'black'], openings: ['sicilian', 'slav']},
    {name: 'Оба цвета vs Stockfish 4',                     engine: 4, colors: ['white', 'black'], openings: []},
    {name: 'Оба цвета vs Stockfish 5',                     engine: 5, colors: ['white', 'black'], openings: []}
    // дальше — решим, когда дойдём
  ],

  // Дебюты. Статус считается сам:
  //   этап дебюта уже начался → «Изучаю» (изученные остаются вторым планом),
  //   этап следующий → «Далее», дебют без этапа → «В планах».
  //   id      — короткое имя латиницей (используется в stages[].openings)
  //   color   — каким цветом играю ('white' | 'black')
  //   vs      — только для чёрных: на какой первый ход бота играю этот дебют ('e4' | 'd4' | 'c4' | 'Nf3')
  //   match   — как дебют называется у Lichess (часть названия) — для галочек в таблице и статистики
  //   studies — студии Lichess (id — из адреса lichess.org/study/<id>, parts — число частей,
  //             ids — id всех частей по порядку, первая = id; нужны, чтобы сверять ходы с мастером.
  //             Студия должна быть открыта хотя бы по ссылке (Unlisted), иначе скрипт её не скачает;
  //             aka — другие написания фамилии мастера в студии, например ['Kortschnoj'] для Korchnoi)
  openings: [
    {id: 'italian',  name: 'Итальянская',  color: 'white', match: ['Italian Game'],
     studies: [{master: 'Carlsen', id: 'nhubKmIC', parts: 2, ids: ['nhubKmIC', 'kW7SBd3P']},
               {master: 'So', id: 'N67BQubO', parts: 3, ids: ['N67BQubO', 'KOi3OHVa', 'ihEjjoGE']}]},
    {id: 'sicilian', name: 'Сицилианская', color: 'black', vs: 'e4', match: ['Sicilian Defense'],
     studies: [{master: 'Carlsen', id: 'dax8pRRF', parts: 7, ids: ['dax8pRRF', 'aawsj5mM', 'xDOvwI98', 'rIRR9SiY', 'h4nnyKxz', 'YrsKfx4f', 'arekcv83']}]},
    {id: 'slav',     name: 'Славянская',   color: 'black', vs: 'd4', match: ['Slav Defense'],
     studies: [{master: 'Kramnik', id: '3RYYgqp3', parts: 2, ids: ['3RYYgqp3', 'kD1ktlel']}]},
    // в планах (этап не назначен)
    {id: 'london',   name: 'Лондонская',   color: 'white', match: ['London System'],
     studies: [{master: 'Kamsky', id: 'aUBTZkzt', parts: 3, ids: ['aUBTZkzt', 'sBg5bUd4', 'AydTPDly']}]},
    {id: 'french',   name: 'Французская',  color: 'black', vs: 'e4', match: ['French Defense'],
     studies: [{master: 'Korchnoi', aka: ['Kortschnoj'], id: '0942TaOS', parts: 3, ids: ['0942TaOS', 'X64r98nT', 'OLE3gBby']}]},
    {id: 'ruy',      name: 'Испанская',    color: 'white', match: ['Ruy Lopez'],
     studies: [{master: 'Carlsen', id: 'NiBvAB6p', parts: 5}, {master: 'Kasparov', id: 'TyLTwVqg', parts: 1}, {master: 'Kramnik', id: 'mTH3VfOo', parts: 2}]},
    {id: 'najdorf',  name: 'Сицилианская Найдорф', color: 'black', vs: 'e4', match: ['Sicilian Defense: Najdorf'],
     studies: [{master: 'Kasparov', id: 'CbxETWPo', parts: 1, ids: ['CbxETWPo']}]}
    // Студии, которые сейчас не в планах (чтобы вернуть — добавь строкой выше):
    //   {id: 'kings-gambit', name: 'Королевский гамбит', color: 'white', match: ["King's Gambit"], studies: [{master: 'Spassky', id: '9I3pKaXa', parts: 1}]},
    //   {id: 'berlin', name: 'Берлинская', color: 'black', vs: 'e4', match: ['Ruy Lopez: Berlin Defense'], studies: [{master: 'Carlsen', id: 'u1aCC4Rl', parts: 1}, {master: 'Kramnik', id: 'sDKxJweM', parts: 1}]},
    //   {id: 'grunfeld', name: 'Грюнфельд', color: 'black', vs: 'd4', match: ['Grünfeld Defense'], studies: [{master: 'Kasparov', id: 'EUgkzb3x', parts: 1}]},
  ]
};
