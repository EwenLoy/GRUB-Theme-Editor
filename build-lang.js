// сборка lang-data.js: встраивает lang/*.json в один файл (работа через file://)
const fs = require('fs');
const out = {};
for (const f of fs.readdirSync('lang').filter(f => f.endsWith('.json'))) {
  const code = f.replace(/\.json$/, '');
  out[code] = JSON.parse(fs.readFileSync('lang/' + f, 'utf8'));
}
fs.writeFileSync('lang-data.js', '// АВТОГЕНЕРАЦИЯ из lang/*.json (node build-lang.js). Не править руками.\nconst I18N_EMBED = ' + JSON.stringify(out) + ';\n');
console.log('lang-data.js: languages =', Object.keys(out).join(', '));