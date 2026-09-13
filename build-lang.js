// сборка lang-data.js: встраивает lang/*.json в один файл (работа через file://)
const fs = require('fs');
// докладываем недостающие переводы, если translations.json есть рядом
if (fs.existsSync('translations.json')) {
  const add = JSON.parse(fs.readFileSync('translations.json', 'utf8'));
  const en = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'));
  Object.assign(en, add.exact || {});
  if (add.rules) en.__rules = [...(add.rules || []), ...(en.__rules || [])];
  fs.writeFileSync('lang/en.json', JSON.stringify(en, null, 2) + '\n');
  console.log('en.json updated from translations.json');
}
const out = {};
for (const f of fs.readdirSync('lang').filter(f => f.endsWith('.json'))) {
  const code = f.replace(/\.json$/, '');
  out[code] = JSON.parse(fs.readFileSync('lang/' + f, 'utf8'));
}
fs.writeFileSync('lang-data.js', '// АВТОГЕНЕРАЦИЯ из lang/*.json (node build-lang.js). Не править руками.\nconst I18N_EMBED = ' + JSON.stringify(out) + ';\n');
console.log('lang-data.js: languages =', Object.keys(out).join(', '));