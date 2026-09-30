// Копия chess.js для браузера: lib/chess.js (подключается страницей только в режиме «Анализ»).
// В node_modules лежит CommonJS-сборка — оборачиваем её, чтобы в браузере появился window.Chess.
// Запуск после обновления chess.js в scripts/package.json: `node scripts/vendor-chess.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, 'node_modules', 'chess.js');
const { version, license } = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const src = readFileSync(join(PKG, 'dist', 'cjs', 'chess.js'), 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
const licenseText = readFileSync(join(PKG, 'LICENSE'), 'utf8').trim().split('\n').map((l) => ' * ' + l).join('\n');

writeFileSync(join(HERE, '..', 'lib', 'chess.js'),
  `/*!\n * chess.js ${version} (${license}) — https://github.com/jhlywa/chess.js\n` +
  ` * Создано scripts/vendor-chess.mjs из node_modules — не править вручную.\n *\n${licenseText}\n */\n` +
  '(function() {\nvar exports = {};\n' + src + '\nwindow.Chess = exports.Chess;\n})();\n');
console.log(`lib/chess.js ← chess.js ${version}`);
