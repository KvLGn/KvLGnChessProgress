// Проверка data/plan.js и запасная копия плана (data/plan-good.js).
//   node scripts/plan-check.mjs — проверить план: ошибки → код выхода 1 (на GitHub — красный крестик и письмо);
//   loadPlanState() — для update.mjs: план, проверка, запасная копия, прогресс.
// Правила проверки — lib/stages.js (те же, что на сайте).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const PROGRESS = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(PROGRESS, 'data');
export const PLAN_JS = join(DATA, 'plan.js');
export const PLAN_GOOD_JS = join(DATA, 'plan-good.js');
export const PROGRESS_JS = join(DATA, 'progress.js');
const STAGES_JS = join(PROGRESS, 'lib', 'stages.js');

// выполнить браузерный файл вида window.X = … в песочнице; '' — без ошибок, иначе текст ошибки (со строкой)
function run(file, ctx, tail = '') {
  if (!existsSync(file)) return 'файла нет';
  try { vm.runInContext(readFileSync(file, 'utf8') + tail, ctx, { filename: file }); return ''; }
  catch (e) {
    const line = ((e.stack || '').match(/\.js:(\d+)/) || [])[1];
    const msg = (line ? `строка ${line}: ` : '') + e.message;
    console.log(`  ! ${file.split(/[\\/]/).pop()}: ${msg}`);
    return msg;
  }
}

export function loadPlanState() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  if (run(STAGES_JS, ctx) || !ctx.STAGES) throw new Error('lib/stages.js не загрузился');
  // «const PLAN = …» вместо «window.PLAN = …» — тоже принимаем (так иногда пишут ИИ), с предупреждением
  const planErr = run(PLAN_JS, ctx, '\n;try { if (!window.PLAN && typeof PLAN === "object") { window.PLAN = PLAN; window.PLAN_CONST = true; } } catch (e) {}');
  const progressOk = !existsSync(PROGRESS_JS) || !run(PROGRESS_JS, ctx);
  if (existsSync(PLAN_GOOD_JS)) run(PLAN_GOOD_JS, ctx);
  const S = ctx.STAGES;
  const progress = ctx.PROGRESS || { stages: [] };
  // ошибка при выполнении plan.js — план не использовать, даже если window.PLAN успел записаться (как на сайте)
  const check = planErr
    ? { ok: false, errors: [planErr === 'файла нет' ? 'нет файла data/plan.js'
        : 'ошибка в plan.js, ' + planErr + ' (лишняя/пропущенная запятая, скобка, кавычка или текст вне кода)'], warnings: [] }
    : S.validatePlan(ctx.PLAN, progress);
  if (ctx.PLAN_CONST) check.warnings.unshift('в plan.js написано «const PLAN =» — правильно «window.PLAN =» (сайт работает, но лучше исправить)');
  return { S, plan: check.ok ? ctx.PLAN : null, check, progress, progressOk, good: ctx.PLAN_GOOD || null };
}

// запасная копия: обновляется, только когда план исправен и изменился
export function saveGoodPlan(state, stamp) {
  if (!state.check.ok) return false;
  const json = JSON.stringify(state.plan);
  if (state.good && JSON.stringify(state.good.plan) === json) return false;
  writeFileSync(PLAN_GOOD_JS,
    '// Создаётся автоматически скриптом update.mjs — не редактировать вручную.\n' +
    '// Последняя рабочая копия data/plan.js: если plan.js сломан, сайт и обновление данных берут план отсюда.\n' +
    `window.PLAN_GOOD = {at: '${stamp}', plan: ${json}};\n`);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const st = loadPlanState();
  if (st.check.ok) {
    console.log('data/plan.js в порядке.');
    st.check.warnings.forEach((w) => console.log('  предупреждение: ' + w));
  } else {
    console.log('ОШИБКА: data/plan.js сломан — сайт показывает последнюю рабочую копию плана' + (st.good ? ` (от ${st.good.at})` : '') + '.');
    st.check.errors.forEach((e) => console.log('  - ' + e));
    console.log('Исправь файл или верни прошлую версию: GitHub → data/plan.js → History.');
    process.exitCode = 1;
  }
}
