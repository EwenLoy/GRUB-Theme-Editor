const fs = require('fs');
let src = fs.readFileSync('editor.js', 'utf8');
src += '\n' + fs.readFileSync('index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
// убираем комментарии — они не попадают в DOM
src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cyr = /[\u0400-\u04FF]/;
const frags = new Set();
const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/gs;
let m;
while ((m = re.exec(src))) {
  const q = m[1], body = m[2];
  if (!cyr.test(body)) continue;
  let text = body;
  if (q === '`') text = text.replace(/\$\{[^}]*\}/g, '\u0001');
  const pieces = text.replace(/<[^>]*>/g, '\n').split(/[\n\u0001]+/);
  for (let p of pieces) {
    p = p.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/^[<>\s]+|[<>\s]+$/g, '').trim();
    if (!cyr.test(p)) continue;
    if (p.startsWith('#')) continue;          // комментарии theme.txt — в файл, не в UI
    if (/^(error:|grub-core|fetch|file:)/i.test(p)) continue;
    if (p.length > 300) continue;
    frags.add(p);
  }
}
const en = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'));
const has = s => {
  if (en[s] !== undefined) return true;
  return en.__rules.some(([r]) => { try { return new RegExp(r).test(s); } catch { return false; } });
};
const missing = [...frags].sort().filter(s => !has(s));
fs.writeFileSync('i18n-report.txt', '\uFEFFMISSING ' + missing.length + '\n' + missing.map(s => JSON.stringify(s)).join('\n'), 'utf8');
console.log('written, missing =', missing.length);