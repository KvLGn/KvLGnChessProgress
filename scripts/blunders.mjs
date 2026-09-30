// Типы зевков по анализу Lichess: оценка после каждого полухода + лучший ход у каждого зевка.
// Позиции восстанавливаются через chess.js, тип определяется по тому, что изменилось на доске.
//   mateAllowed — после хода у соперника есть мат
//   mateMissed  — до хода у меня был мат, после — нет
//   hang        — после хода соперник может выгодно взять мою фигуру (не защищена или бьёт более дешёвой)
//   tactic      — сразу ничего не висит, но в следующие 2 хода соперника материал ушёл (вилка, связка, двойной удар)
//   missedWin   — лучший ход был выгодным взятием или шахом, а сыгран другой
//   other       — остальное (позиционный провал, долгий расчёт)
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MATE = 100000;

// оценка с точки зрения игрока (сантипешки; мат — очень большое число)
function score(e, meWhite) {
  if (!e) return 0;
  const s = meWhite ? 1 : -1;
  if (typeof e.mate === 'number') return s * Math.sign(e.mate) * (MATE - Math.abs(e.mate));
  return s * (e.eval || 0);
}
const isMateFor = (e, meWhite, mine) => e && typeof e.mate === 'number' && ((e.mate > 0) === meWhite) === mine;

// самое выгодное взятие соперника в позиции (ход соперника): {victim, attacker, square, gain} или null
function bestCapture(Chess, fen) {
  const c = new Chess(fen);
  let best = null;
  for (const mv of c.moves({ verbose: true })) {
    if (!mv.captured) continue;
    const victim = VALUE[mv.captured], attacker = VALUE[mv.piece];
    c.move(mv);
    const recapture = c.moves({ verbose: true }).some((r) => r.to === mv.to && r.captured);
    c.undo();
    const gain = recapture ? victim - attacker : victim;   // простая оценка размена на одном поле
    if (gain >= 2 && (!best || gain > best.gain)) best = { victim: mv.captured, attacker: mv.piece, square: mv.to, gain };
  }
  return best;
}

// материал игрока минус материал соперника в позиции
function material(Chess, fen, meWhite) {
  const b = new Chess(fen).board(); let m = 0;
  b.forEach((row) => row.forEach((p) => { if (p) m += (p.color === 'w') === meWhite ? VALUE[p.type] : -VALUE[p.type]; }));
  return m;
}
// выгода взятия в позиции: жертва минус атакующий, если поле защищено; иначе вся жертва
function captureGain(Chess, fen, mv) {
  const c = new Chess(fen); c.move(mv);
  const re = c.moves({ verbose: true }).some((r) => r.to === mv.to && r.captured);
  return re ? VALUE[mv.captured] - VALUE[mv.piece] : VALUE[mv.captured];
}

// сколько материала выигрывает лучшая линия движка за первые plies полуходов (с точки зрения игрока)
function lineGain(Chess, fen, variation, meWhite, plies) {
  const c = new Chess(fen), m0 = material(Chess, fen, meWhite);
  for (const x of (variation || '').split(' ').filter(Boolean).slice(0, plies)) { try { c.move(x); } catch (e) { break; } }
  return material(Chess, c.fen(), meWhite) - m0;   // чётное число полуходов — с учётом ответного взятия
}

export function classifyBlunders(Chess, g, meColor, division) {
  const moves = (g.moves || '').split(' ').filter(Boolean);
  const an = g.analysis || [];
  const meWhite = meColor === 'white';
  const c = new Chess();
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const mine = (i % 2 === 0) === meWhite;
    const a = an[i];
    if (mine && a && a.judgment && a.judgment.name === 'Blunder') {
      const before = i ? an[i - 1] : { eval: 20 };
      const fenBefore = c.fen();
      const bestSan = (a.variation || '').split(' ')[0] || null;
      let bestMove = null;
      if (bestSan) { const t = new Chess(fenBefore); try { bestMove = t.move(bestSan); } catch (e) { bestMove = null; } }
      const played = c.move(moves[i]);
      // материал через 2 хода соперника (4 полухода) по реальной партии
      const t = new Chess(c.fen()); const mat0 = material(Chess, fenBefore, meWhite);
      for (let j = i + 1; j < Math.min(moves.length, i + 5); j++) { try { t.move(moves[j]); } catch (e) { break; } }
      const lost = mat0 - material(Chess, t.fen(), meWhite);
      let type = 'other', piece = null, square = null;
      const hung = bestCapture(Chess, c.fen());
      if (isMateFor(a, meWhite, false)) type = 'mateAllowed';
      else if (isMateFor(before, meWhite, true) && !isMateFor(a, meWhite, true)) type = 'mateMissed';
      else if (hung && hung.victim !== 'p') { type = 'hang'; piece = hung.victim; square = hung.square; }
      else if (lost >= 2) type = 'tactic';
      else if (bestMove && bestMove.san !== played.san && (lineGain(Chess, fenBefore, a.variation, meWhite, 6) >= 2 ||
               (bestMove.captured && (VALUE[bestMove.captured] >= 3 || captureGain(Chess, fenBefore, bestMove) >= 1)))) {
        type = 'missedWin'; if (bestMove.captured) { piece = bestMove.captured; square = bestMove.to; }
      }
      else if (hung) { type = 'hang'; piece = hung.victim; square = hung.square; }
      const ply = i + 1;
      const phase = !division ? null : division.middle && ply < division.middle ? 'debut' : division.end && ply >= division.end ? 'end' : 'mid';
      out.push({ m: Math.floor(i / 2) + 1, s: played.san, t: type, p: phase, b: bestSan, x: piece, q: square,
                 d: typeof a.mate === 'number' || typeof before.mate === 'number' ? null : Math.round((score(before, meWhite) - score(a, meWhite)) / 10) / 10 });
    } else {
      c.move(moves[i]);
    }
  }
  return out;
}
