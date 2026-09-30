// Дебюты: что изучаю, что следующее, что в планах. Правится вручную (или попроси Claude).
// Чтобы перейти к следующему дебюту — перенеси его из next в current, а изученный — в done.
//   color   — за какой цвет играю этот дебют ('white' | 'black')
//   match   — как дебют называется у Lichess (подстрока названия); по ним считаются партии и задачи
//   studies — студии Lichess (по одной на мастера — первая часть)
window.OPENINGS = {
  current: [
    {name: 'Итальянская', color: 'white', match: ['Italian Game'],
     studies: [{master: 'Carlsen', id: 'nhubKmIC', parts: 2}, {master: 'So', id: 'N67BQubO', parts: 3}]}
  ],
  next: [
    {name: 'Сицилианская', color: 'black', match: ['Sicilian Defense'],
     studies: [{master: 'Carlsen', id: 'dax8pRRF', parts: 7}]},
    {name: 'Славянская', color: 'black', match: ['Slav Defense'],
     studies: [{master: 'Kramnik', id: '3RYYgqp3', parts: 2}]}
  ],
  planned: [
    {name: 'Лондонская', color: 'white', match: ['London System'],
     studies: [{master: 'Kamsky', id: 'aUBTZkzt', parts: 3}]},
    {name: 'Французская', color: 'black', match: ['French Defense'],
     studies: [{master: 'Korchnoi', id: '0942TaOS', parts: 3}]},
    {name: 'Испанская', color: 'white', match: ['Ruy Lopez'],
     studies: [{master: 'Carlsen', id: 'NiBvAB6p', parts: 5}, {master: 'Kasparov', id: 'TyLTwVqg', parts: 1}, {master: 'Kramnik', id: 'mTH3VfOo', parts: 2}]},
    {name: 'Сицилианская Найдорф', color: 'black', match: ['Sicilian Defense: Najdorf'],
     studies: [{master: 'Kasparov', id: 'CbxETWPo', parts: 1}]}
  ],
  // Студии, которые сейчас не в планах (чтобы вернуть — перенеси строку в planned):
  //   {name: 'Королевский гамбит', color: 'white', match: ["King's Gambit"], studies: [{master: 'Spassky', id: '9I3pKaXa', parts: 1}]},
  //   {name: 'Берлинская', color: 'black', match: ['Ruy Lopez: Berlin Defense'], studies: [{master: 'Carlsen', id: 'u1aCC4Rl', parts: 1}, {master: 'Kramnik', id: 'sDKxJweM', parts: 1}]},
  //   {name: 'Грюнфельд', color: 'black', match: ['Grünfeld Defense'], studies: [{master: 'Kasparov', id: 'EUgkzb3x', parts: 1}]},
  done: []
};
