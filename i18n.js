/* ============================================================
   i18n: переключение языка интерфейса редактора.
   Словари лежат в lang/<код>.json (формат: точные пары "русское" -> "перевод"
   + массив __rules: [ [регэксп, подстановка], ... ] для динамических строк).
   Русский — «родной» язык кода: словарь не применяется.
   Подключение: lang-data.js содержит встроенные словари (работает при file://),
   а для lang/<другие>.json дополнительно пробуется fetch() (работает по http).
   ============================================================ */

const I18N = {
  lang: localStorage.getItem('grub-editor-lang') || 'en',
  dicts: {},           // lang -> { exact:{}, rules:[[RegExp, str]] }
  _observer: null,
  _guard: false,       // защита от зацикливания MutationObserver на своих же правках
};

function i18nSetDict(lang, obj) {
  const exact = {};
  const rules = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === '_comment' || k === '__comment') continue;
    if (k === '__rules') {
      for (const r of v) {
        try { rules.push([new RegExp(r[0], ''), r[1]]); }
        catch (err) { console.error('i18n: bad rule', r[0], err); }
      }
      continue;
    }
    exact[k] = v;
  }
  I18N.dicts[lang] = { exact, rules };
}

// основной перевод строки: точное совпадение -> regex-правила (первое подошедшее)
function t(s) {
  if (I18N.lang === 'ru') return s;
  const d = I18N.dicts[I18N.lang];
  if (!d) return s;
  if (Object.prototype.hasOwnProperty.call(d.exact, s)) return d.exact[s];
  for (const [re, rep] of d.rules) {
    if (re.test(s)) return s.replace(re, rep);
  }
  return s;
}
// применить перевод ко всем видимым текстовым узлам и атрибутам
function i18nApply(root) {
  if (I18N.lang === 'ru') { i18nRestore(root); return; }
  const d = I18N.dicts[I18N.lang];
  if (!d) return;
  I18N._guard = true;
  try {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const orig = node.nodeValue;
      if (!orig || !orig.trim()) continue;
      if (node.__i18nOrig === undefined) node.__i18nOrig = orig;
      let tr = t(node.__i18nOrig);
      // текстовые узлы часто содержат хвостовые пробелы/переносы ("Новый проект ")
      // — тогда точное совпадение с ключом словаря не срабатывает. Пробуем
      // перевод обрезанной строки, сохраняя исходные отступы по краям.
      if (tr === node.__i18nOrig) {
        const core = node.__i18nOrig.trim();
        if (core !== node.__i18nOrig) {
          const t2 = t(core);
          if (t2 !== core) tr = node.__i18nOrig.replace(core, t2);
        }
      }
      if (tr !== orig) node.nodeValue = tr;
    }
    // атрибуты placeholder/title у инпутов и кнопок
    (root || document).querySelectorAll('[placeholder],[title]').forEach(el => {
      ['placeholder', 'title'].forEach(attr => {
        const v = el.getAttribute(attr);
        if (!v) return;
        const key = '__i18nOrig_' + attr;
        if (el[key] === undefined) el[key] = v;
        const tr = t(el[key]);
        if (tr !== v) el.setAttribute(attr, tr);
      });
    });
  } finally { I18N._guard = false; }
}

// вернуть оригинальные строки (при переключении обратно на ru)
function i18nRestore(root) {
  I18N._guard = true;
  try {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.__i18nOrig !== undefined && node.nodeValue !== node.__i18nOrig) {
        node.nodeValue = node.__i18nOrig;
      }
    }
    (root || document).querySelectorAll('[placeholder],[title]').forEach(el => {
      ['placeholder', 'title'].forEach(attr => {
        const key = '__i18nOrig_' + attr;
        if (el[key] !== undefined) el.setAttribute(attr, el[key]);
      });
    });
  } finally { I18N._guard = false; }
}
// подгрузка словаря: встроенный (lang-data.js) или fetch lang/<lang>.json
async function i18nLoadDict(lang) {
  if (I18N.dicts[lang]) return I18N.dicts[lang];
  if (typeof I18N_EMBED !== 'undefined' && I18N_EMBED && I18N_EMBED[lang]) {
    i18nSetDict(lang, I18N_EMBED[lang]);
    return I18N.dicts[lang];
  }
  try {
    const res = await fetch(`lang/${lang}.json`);
    if (!res.ok) throw new Error('not ok');
    i18nSetDict(lang, await res.json());
    return I18N.dicts[lang];
  } catch (err) { return null; }
}

async function i18nSetLang(lang) {
  I18N.lang = lang;
  localStorage.setItem('grub-editor-lang', lang);
  await i18nLoadDict(lang);
  i18nApply();
  const btn = document.getElementById('btn-lang');
  if (btn) btn.textContent = lang.toUpperCase();
}

// следим за DOM: редактор постоянно перерисовывает панели через innerHTML —
// переводим новые тексты «на лету», не трогая сам код редактора
function i18nStart() {
  if (typeof I18N_EMBED !== 'undefined' && I18N_EMBED) {
    Object.keys(I18N_EMBED).forEach(l => i18nSetDict(l, I18N_EMBED[l]));
  }
  const pending = new Set();
  let scheduled = false;
  I18N._observer = new MutationObserver(muts => {
    if (I18N._guard) return;
    for (const m of muts) {
      if (m.type === 'characterData' && m.target.parentNode) pending.add(m.target.parentNode);
      m.addedNodes.forEach(n => pending.add(n.nodeType === 1 ? n : n.parentNode));
      if (m.type === 'attributes') pending.add(m.target);
    }
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (I18N.lang === 'ru') return;
        pending.forEach(n => { if (n && n.isConnected) i18nApply(n); });
        pending.clear();
      });
    }
  });
  I18N._observer.observe(document.body, {
    childList: true, characterData: true, subtree: true,
    attributes: true, attributeFilter: ['placeholder', 'title'],
  });
  i18nSetLang(I18N.lang);
  // кнопка-переключатель: клик = следующий язык из списка доступных
  const btn = document.getElementById('btn-lang');
  if (btn) btn.addEventListener('click', async () => {
    const known = new Set(['ru', 'en']);
    if (typeof I18N_EMBED !== 'undefined' && I18N_EMBED) Object.keys(I18N_EMBED).forEach(l => known.add(l));
    const order = [...known];
    const next = order[(order.indexOf(I18N.lang) + 1) % order.length];
    await i18nSetLang(next);
  });
}

// переводим также alert/confirm/prompt-строки редактора
if (I18N.lang !== 'ru') {
  const origAlert = window.alert;
  window.alert = function (msg) { return origAlert(typeof msg === 'string' ? t(msg) : msg); };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', i18nStart);
} else {
  i18nStart();
}