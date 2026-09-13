/* ============================================================
   ПРЕСЕТЫ РАЗРЕШЕНИЙ
   ============================================================ */

const RESOLUTION_PRESETS = [
  { label: '640x480 (VGA 4:3)',        w: 640,  h: 480 },
  { label: '800x600 (SVGA 4:3)',       w: 800,  h: 600 },
  { label: '1024x768 (XGA 4:3)',       w: 1024, h: 768 },
  { label: '1280x720 (HD 16:9)',       w: 1280, h: 720 },
  { label: '1280x1024 (SXGA 5:4)',     w: 1280, h: 1024 },
  { label: '1366x768 (HD Widescreen)', w: 1366, h: 768 },
  { label: '1920x1080 (Full HD 16:9)', w: 1920, h: 1080 },
];

/* ============================================================
   МОДЕЛЬ ДАННЫХ
   ============================================================ */

let STAGE_W = 1920, STAGE_H = 1080; // реальное разрешение темы, теперь изменяемое
let canvas = document.getElementById('stage');
let ctx = canvas.getContext('2d');
const CANVAS_BASE_PX = 960; // ширина канвас-элемента при zoom = 100% / (STAGE_W/960)... пересчитывается ниже
let zoom = 0.5; // 50% от реального разрешения по умолчанию
let scale = 1;  // px канвас-элемента на 1 px темы = zoom (пересчитывается в resizeStage)

let layers = [];
let selectedId = null;
let idCounter = 1;
let bgImage = null;
let bgImageUrl = null;
let bgColor = '#000000';

// ---- глобальные корневые свойства темы (Приоритет 1/3) ----
let theme = {
  bgScaleMethod: 'stretch',      // stretch | crop | padding | fitwidth | fitheight
  bgHAlign: 'center',            // left | center | right
  bgVAlign: 'center',            // top | center | bottom
  titleVisible: false,
  titleText: '',
  titleFont: 'DejaVu Sans Mono Bold 28',
  titleColor: '#ffffff',
  terminalVisible: false,
  terminalBoxImg: null,          // 9-patch base url (name_*.png эмулируется одной картинкой)
  terminalBorder: 12,
  terminalLeft: 10, terminalTop: 10, terminalWidth: 80, terminalHeight: 80, // в %
  coordMode: 'percent',          // percent | px — формат экспортируемых координат
};

function resizeStage() {
  canvas.width = Math.round(STAGE_W * zoom);
  canvas.height = Math.round(STAGE_H * zoom);
  scale = zoom;
  document.getElementById('zoom-val').textContent = Math.round(zoom * 100) + '%';
}

/* ---------- слои: базовая модель + фабрика ---------- */

function makeLayer(type, overrides = {}) {
  const base = {
    id: idCounter++,
    type,
    name: type,
    x: 200, y: 200, w: 400, h: 60,
    visible: true,
    color: '#cccccc',
    selectedColor: '#ffffff',
    fontSize: 22,
    text: 'Пункт меню',
    itemHeight: 48,
    itemCount: 3,
    barColor: '#3d5f4d',
    barBg: '#2a2a2a',
    showBarText: false,
    barText: '%d сек. до автозагрузки',
    circleColor: '#3d8a6e',
    circleBg: '#2a2a2a',
    circleText: '10s',
    boxColor: 'rgba(255,255,255,0.06)',
    boxBorder: '#ffffff33',
    imgUrl: null,
    align: 'left',            // left | center | right (для label)
    fontName: 'DejaVu Sans Mono',
    fontBold: false,          // Regular по умолчанию — как в реальных темах
    useTimeoutId: false,      // id="__timeout__" — автообновляемый компонент
    // 9-patch подложки для пунктов меню (общие на весь слой menu)
    menuNormalBg: null,
    menuSelectedBg: null,
    menuNormalBorder: 6,
    menuSelectedBorder: 6,
    menuBorderImg: null,       // menu_pixmap_style — рамка всего меню
    menuBorderBorder: 10,
    itemPadding: 6,
    itemSpacing: 0,
    itemIconSpace: 8,
    maxItemsShown: 0,          // 0 = все
    selectedFontSize: null,    // null = inherit
    scrollbarEnabled: false,
    scrollbarFrameImg: null,
    scrollbarThumbImg: null,
    scrollbarThumbOverlay: false,
    scrollbarSlice: 'east',    // west | center | east
    scrollbarLeftPad: 0, scrollbarRightPad: 0, scrollbarTopPad: 0, scrollbarBottomPad: 0,
    // progress_bar styled boxes
    barStyleImg: null,         // bar_style (рамка)
    barStyleBorder: 8,
    highlightStyleImg: null,   // highlight_style (заливка)
    highlightStyleBorder: 8,
    highlightOverlay: false,
    // circular_progress — дефолты GRUB: num_ticks=64, start_angle=-64 (= 12 часов), тики ПОЯВЛЯЮТСЯ
    centerBitmap: null,
    tickBitmap: null,
    numTicks: 64,
    startAngle: -64,
    ticksDisappear: false,
  };
  const l = Object.assign(base, overrides);
  l.name = defaultName(l);
  return l;
}

function defaultName(l) {
  switch (l.type) {
    case 'menu': return 'Меню загрузки';
    case 'progress': return 'Прогресс-бар';
    case 'circular': return 'Круговой прогресс';
    case 'label': return 'Текст: ' + (l.text || '').slice(0, 14);
    case 'box': return 'Прямоугольник';
    case 'image': return 'Картинка' + (l.imgName ? ': ' + l.imgName : '');
    default: return l.type;
  }
}

function getMenuLayer() { return layers.find(l => l.type === 'menu') || null; }
function addLayer(type, atX, atY) {
  // GRUB docs: boot_menu — единственный, второй не имеет смысла. Ограничиваем одним.
  if (type === 'menu' && getMenuLayer()) {
    const existing = getMenuLayer();
    selectedId = existing.id;
    renderAll();
    // мигнём выделением чтобы было понятно почему не создался
    const el = document.querySelector(`.layer-item[data-id="${existing.id}"]`);
    if (el) { el.animate([{outline:'2px solid var(--accent)'},{outline:'none'}],{duration:700}); el.scrollIntoView({block:'nearest'}); }
    return existing;
  }
  let l;
  if (type === 'menu') {
    l = makeLayer('menu', { x: atX ?? 160, y: atY ?? 380, w: 700, h: 46 * 4, itemHeight: 46, itemCount: 4 });
  } else if (type === 'progress') {
    l = makeLayer('progress', { x: atX ?? 160, y: atY ?? 900, w: 900, h: 28, useTimeoutId: true, showBarText: true });
  } else if (type === 'circular') {
    l = makeLayer('circular', { x: atX ?? 1500, y: atY ?? 700, w: 90, h: 90, useTimeoutId: true });
  } else if (type === 'label') {
    l = makeLayer('label', { x: atX ?? 160, y: atY ?? 200, w: 500, h: 60, text: 'GRUB', fontSize: 40 });
  } else if (type === 'box') {
    l = makeLayer('box', { x: atX ?? 1400, y: atY ?? 380, w: 200, h: 150 });
  } else if (type === 'image') {
    l = makeLayer('image', { x: atX ?? 1400, y: atY ?? 200, w: 200, h: 200 });
  }
  layers.push(l);
  selectedId = l.id;
  renderAll();
  return l;
}

function getLayer(id) { return layers.find(l => l.id === id); }
function removeLayer(id) {
  layers = layers.filter(l => l.id !== id);
  if (selectedId === id) selectedId = null;
  renderAll();
}
function moveLayer(id, newIndex) {
  const cur = layers.findIndex(l => l.id === id);
  if (cur === -1) return;
  newIndex = Math.max(0, Math.min(layers.length - 1, newIndex));
  if (cur === newIndex) return;
  const [item] = layers.splice(cur, 1);
  layers.splice(newIndex, 0, item);
  renderAll();
}
function reorderLayer(id, dir) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return;
  if (dir === 'front') moveLayer(id, layers.length - 1);
  else if (dir === 'back') moveLayer(id, 0);
  else if (dir === 'forward') moveLayer(id, idx + 1);
  else if (dir === 'backward') moveLayer(id, idx - 1);
}
function duplicateLayer(id) {
  const src = getLayer(id);
  if (!src) return null;
  if (src.type === 'menu' && getMenuLayer()) return null;
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = idCounter++;
  clone.x = Math.round((clone.x || 0) + 16);
  clone.y = Math.round((clone.y || 0) + 16);
  clone.name = defaultName(clone);
  // вставляем сразу над оригиналом (выше = позже в массиве)
  const idx = layers.findIndex(l => l.id === id);
  layers.splice(idx + 1, 0, clone);
  selectedId = clone.id;
  renderAll();
  return clone;
}

/* ============================================================
   ИЗОБРАЖЕНИЯ: общий кэш (фон, osEntries, image-слои, menu bg)
   ============================================================ */

const imgCache = {};
function cacheImage(url, onDone) {
  if (!url) return;
  if (imgCache[url]) { if (onDone) onDone(imgCache[url]); return; }
  const img = new Image();
  img.onload = () => { if (onDone) onDone(img); renderAll(); };
  img.src = url;
  imgCache[url] = img;
}

/* ---------- Отрисовка фонового изображения с учётом desktop-image-scale-method ----
   GRUB поддерживает 5 режимов (desktop-image-scale-method):
   stretch    — растянуть на весь холст без сохранения пропорций (было раньше — единственный режим в редакторе)
   crop       — масштаб с сохранением пропорций, заполняя весь холст, обрезая лишнее (как CSS background-size: cover)
   padding    — без масштабирования, оригинальный размер, позиционируется по halign/valign, остальное — bgColor
   fitwidth   — масштаб по ширине холста с сохранением пропорций, по высоте — letterbox сверху/снизу по valign
   fitheight  — масштаб по высоте холста с сохранением пропорций, по ширине — letterbox слева/справа по halign
   Используется и в редакторе (drawEditor), и в превью (openPreview/renderFrame) — чтобы поведение совпадало. */
function drawThemeBackground(c, img, cw, ch, method, halign, valign, fillColor) {
  if (!img) { c.fillStyle = fillColor || '#000000'; c.fillRect(0, 0, cw, ch); return; }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) { c.drawImage(img, 0, 0, cw, ch); return; }
  const alignOffset = (avail, size, align) => {
    if (align === 'left' || align === 'top') return 0;
    if (align === 'right' || align === 'bottom') return avail - size;
    return (avail - size) / 2; // center
  };
  method = method || 'stretch';
  if (method === 'stretch') {
    c.drawImage(img, 0, 0, cw, ch);
    return;
  }
  // для остальных режимов сперва заливаем фон цветом (видно в padding/fitwidth/fitheight, если картинка не покрывает весь холст)
  c.fillStyle = fillColor || '#000000';
  c.fillRect(0, 0, cw, ch);
  if (method === 'crop') {
    const scaleFactor = Math.max(cw / iw, ch / ih);
    const dw = iw * scaleFactor, dh = ih * scaleFactor;
    const dx = alignOffset(cw, dw, halign), dy = alignOffset(ch, dh, valign);
    c.save();
    c.beginPath(); c.rect(0, 0, cw, ch); c.clip();
    c.drawImage(img, dx, dy, dw, dh);
    c.restore();
  } else if (method === 'padding') {
    const dx = alignOffset(cw, iw, halign), dy = alignOffset(ch, ih, valign);
    c.save();
    c.beginPath(); c.rect(0, 0, cw, ch); c.clip();
    c.drawImage(img, dx, dy, iw, ih);
    c.restore();
  } else if (method === 'fitwidth') {
    const scaleFactor = cw / iw;
    const dw = cw, dh = ih * scaleFactor;
    const dy = alignOffset(ch, dh, valign);
    c.drawImage(img, 0, dy, dw, dh);
  } else if (method === 'fitheight') {
    const scaleFactor = ch / ih;
    const dh = ch, dw = iw * scaleFactor;
    const dx = alignOffset(cw, dw, halign);
    c.drawImage(img, dx, 0, dw, dh);
  } else {
    c.drawImage(img, 0, 0, cw, ch);
  }
}

/* ---------- Файл -> PNG object URL --------------------------------
   GRUB читает ТОЛЬКО настоящие PNG (grub2's png loader падает на
   "error: png: not a png file" на любом jpg/webp с расширением .png
   и на честных jpg/webp тоже). Здесь любой выбранный файл картинки
   перегоняется через canvas и отдаётся уже как настоящий image/png
   object URL — так что пользователю не нужно самому конвертировать.

   ВАЖНО про прозрачность: PNG-ридер GRUB (grub-core/video/readers/png.c)
   корректно понимает альфа-канал только у "честного" 32-битного RGBA PNG
   без палитры (indexed/8-bit + tRNS), без 16-бит-на-канал и без interlace.
   Если исходник — indexed PNG с tRNS-прозрачностью (частый результат экспорта
   из графредакторов, "Save for Web" и т.п.) или PNG с ICC-профилем/интерлейсом,
   браузер эту прозрачность честно показывает, а GRUB — НЕТ: вместо прозрачных
   пикселей он подставляет чёрный (как непрозрачный чёрный фон). Поэтому в
   редакторе фон выглядит прозрачным, а в реальном GRUB — чёрным.
   Чтобы так не происходило, ЛЮБОЙ файл (даже уже валидный PNG) всегда
   перегоняется через canvas — это гарантированно даёт простой некомпрессованный
   в смысле формата, не-indexed, не-interlaced RGBA PNG, с которым GRUB работает
   предсказуемо. */
function fileToPngObjectURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('no file')); return; }
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const cnv = document.createElement('canvas');
        cnv.width = img.naturalWidth; cnv.height = img.naturalHeight;
        const cctx = cnv.getContext('2d');
        // явно очищаем в прозрачный чёрный (alpha=0), чтобы не потянуть непрозрачный
        // фон канваса — drawImage дальше корректно наложит альфу исходника поверх
        cctx.clearRect(0, 0, cnv.width, cnv.height);
        cctx.drawImage(img, 0, 0);
        cnv.toBlob((pngBlob) => {
          URL.revokeObjectURL(blobUrl);
          if (!pngBlob) { reject(new Error('canvas toBlob failed')); return; }
          resolve(URL.createObjectURL(pngBlob));
        }, 'image/png');
      } catch (err) { URL.revokeObjectURL(blobUrl); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('image decode failed — файл повреждён или не является изображением')); };
    img.src = blobUrl;
  });
}
// Универсальный обработчик <input type="file"> для картинок: конвертирует в PNG и передаёт готовый object URL в callback(url).
// В случае ошибки — показывает alert и не трогает существующее значение.
function handlePickedImageFile(file, onReady, onError) {
  if (!file) return;
  fileToPngObjectURL(file).then(onReady).catch((err) => {
    alert('Не удалось загрузить картинку (' + (err && err.message ? err.message : 'ошибка') + '). Файл должен быть настоящим изображением (PNG/JPEG/WebP и т.п.).');
    if (onError) onError(err);
  });
}

/* ---------- 9-patch (nine-slice) отрисовка ----------
   Поддерживает два случая:
   1) Одна картинка + border — эмулируем 3x3 нарезку сами (как раньше).
   2) Раздельные файлы-куски (как в реальных темах GRUB: name_nw.png,
      name_n.png, ..., name_c.png) — передаются в поле slices как
      { nw,n,ne,w,c,e,sw,s,se } (любое подмножество, например только w/c/e). */
function drawNinePatch(c, urlOrSlices, x, y, w, h, border, pxScale) {
  if (urlOrSlices && typeof urlOrSlices === 'object' && urlOrSlices.__slices) {
    return drawSlicedBox(c, urlOrSlices, x, y, w, h, pxScale);
  }
  // ЧЕСТНОЕ поведение: GRUB НЕ умеет программно нарезать один PNG на 9-slice по border —
  // это всегда набор отдельных файлов prefix_nw.png..prefix_se.png (см. Theme file format,
  // GNU GRUB Manual: "styled box is composed of 9 ... regions" — это ДЕВЯТЬ РАЗНЫХ картинок).
  // Раньше здесь один файл растягивался через canvas как красивый 9-patch — это враньё,
  // так реальный GRUB не рендерит. Одиночный файл в GRUB — это просто bitmap-заливка,
  // растянутая на весь прямоугольник целиком, без сохранения неизменных углов.
  const img = urlOrSlices && imgCache[urlOrSlices];
  if (!img || !img.complete || !img.naturalWidth) return false;
  c.drawImage(img, x, y, w, h);
  return true;
}

// Отрисовка из раздельных файлов-кусков (реальный формат GRUB: name_*.png).
// Работает при ЛЮБОМ подмножестве кусков — если есть только w/c/e (частый
// случай для подложки пункта меню, где верх/низ не нужны), центр и боковины
// просто растягиваются на всю высоту без углов.
function drawSlicedBox(c, slices, x, y, w, h, pxScale) {
  // GRUB : реальный бокс использует родной размер углов/краёв, но если slice больше
  // чем контейнер — пропорционально уменьшает, иначе ломается рендер (гигантские края)
  // pxScale — масштаб холста редактора: x,y,w,h приходят уже в экранных пикселях
  // (l.x * sc), поэтому натуральные размеры кусков тоже нужно умножать на него,
  // иначе на zoom != 100% края рисуются раздутыми/съехавшими (баг рамки меню).
  const k = pxScale || 1;
  const get = (key) => {
    const url = slices[key];
    const img = url && imgCache[url];
    return (img && img.complete && img.naturalWidth) ? img : null;
  };
  const nw = get('nw'), n = get('n'), ne = get('ne');
  const w_ = get('w'), ce = get('c'), e_ = get('e');
  const sw = get('sw'), s = get('s'), se = get('se');
  if (!nw && !n && !ne && !w_ && !ce && !e_ && !sw && !s && !se) return false;

  let leftW = ((nw && nw.naturalWidth) || (w_ && w_.naturalWidth) || (sw && sw.naturalWidth) || 0) * k;
  let rightW = ((ne && ne.naturalWidth) || (e_ && e_.naturalWidth) || (se && se.naturalWidth) || 0) * k;
  let topH = ((nw && nw.naturalHeight) || (n && n.naturalHeight) || (ne && ne.naturalHeight) || 0) * k;
  let botH = ((sw && sw.naturalHeight) || (s && s.naturalHeight) || (se && se.naturalHeight) || 0) * k;
  // если сумма краёв больше контейнера — скейлим края пропорционально вниз
  if (leftW + rightW > w && w > 0) { const s = w / (leftW + rightW); leftW *= s; rightW *= s; }
  if (topH + botH > h && h > 0) { const s = h / (topH + botH); topH *= s; botH *= s; }

  const midW = Math.max(0, w - leftW - rightW);
  const midH = Math.max(0, h - topH - botH);

  const draw = (img, dx, dy, dw, dh) => {
    if (!img || dw <= 0 || dh <= 0) return;
    c.drawImage(img, dx, dy, dw, dh);
  };

  // углы — оригинальный размер картинки (не растягиваются)
  draw(nw, x, y, leftW, topH);
  draw(ne, x + w - rightW, y, rightW, topH);
  draw(sw, x, y + h - botH, leftW, botH);
  draw(se, x + w - rightW, y + h - botH, rightW, botH);
  // края — растягиваются по одной оси
  draw(n, x + leftW, y, midW, topH);
  draw(s, x + leftW, y + h - botH, midW, botH);
  draw(w_, x, y + topH, leftW, midH);
  draw(e_, x + w - rightW, y + topH, rightW, midH);
  // центр — растягивается по обеим осям
  draw(ce, x + leftW, y + topH, midW, midH);
  return true;
}

// Обёртка для полей ввода "9-patch слот": картинка + число (border).
// РЕАЛЬНЫЙ 9-slice виджет: GRUB не умеет сам нарезать один PNG на 9 частей —
// menu_pixmap_style / item_pixmap_style / selected_item_pixmap_style / scrollbar_*
// и terminal-box требуют wildcard-паттерн "prefix_*.png", то есть НАБОР из 9 отдельных
// файлов (nw,n,ne,w,c,e,sw,s,se; часть можно не загружать — тогда край/угол просто пустой).
// Раньше здесь был один слот на одну картинку, и редактор сам программно "нарезал" её
// на 9 частей через canvas (border-параметр) — визуально красиво, но GRUB так не делает,
// поэтому в реальной загрузке рамка пропадала. Теперь — 9 честных слотов.
const NINE_SLOTS = [
  ['nw', '↖'], ['n', '↑'], ['ne', '↗'],
  ['w',  '←'], ['c', '·'], ['e',  '→'],
  ['sw', '↙'], ['s', '↓'], ['se', '↘'],
];
function nineSlotHtml(role, val, label, pattern) {
  const isObj = val && typeof val === 'object';
  const rows = NINE_SLOTS.map(([suf, arrow]) => {
    const url = isObj ? val[suf] : (suf === 'c' && val ? val : null); // старую одиночную картинку кладём в центр как есть, без растяжки
    return `
      <div class="img-slot-mini nine-slot-cell" data-role="${role}-${suf}-slot" title="${suf}">
        <div class="thumb">${url ? `<img src="${url}">` : arrow}</div>
      </div>
      <input type="file" accept="image/*" data-role="${role}-${suf}-file" style="display:none;">`;
  }).join('');
  // Если реальной картинки нет, но с импорта осталась "честная" ссылка на путь
  // (pattern) — она всё равно уйдёт в theme.txt при экспорте и будет вырезана
  // санитайзером с предупреждением "файл отсутствует", причём КАЖДЫЙ раз, и убрать
  // её иначе, кроме как загрузив совпадающие PNG, было нечем. Даём явную кнопку сброса.
  const staleWarning = (!val && pattern) ? `
    <div class="hint-small" style="color:#c0392b;">⚠ Из импорта осталась ссылка на «${pattern}» — файлов для неё нет, при экспорте будет предупреждение и строка удалится.
      <button data-role="${role}-clear-pattern" style="margin-left:6px;">✕ убрать ссылку</button>
    </div>` : '';
  return `
    <div class="txt">${label}</div>
    <div class="hint-small" style="margin-bottom:4px;">Загрузите отдельные PNG для углов/краёв/центра (можно не все) — GRUB использует их как <b>${role.replace(/-/g,'_')}_*.png</b>. Один файл на всё меню GRUB растянуть как 9-patch не умеет.</div>
    <div class="nine-slot-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;width:96px;">${rows}</div>
    ${staleWarning}
  `;
}

// Простая ОДНА картинка (не 9-patch) — для слоя "Картинка" и center_bitmap/tick_bitmap
// кругового прогресса, где GRUB ожидает один-единственный PNG-файл, а не набор *_nw/_n/... .
function singleSlotHtml(role, val, label, hint) {
  return `
    <div class="txt">${label}</div>
    ${hint ? `<div class="hint-small" style="margin-bottom:4px;">${hint}</div>` : ''}
    <div class="img-slot-mini single-slot-cell" data-role="${role}-slot" title="картинка">
      <div class="thumb" data-role="${role}-thumb">${val ? `<img src="${val}">` : '🖼'}</div>
    </div>
    <input type="file" accept="image/*" data-role="${role}-file" style="display:none;">
  `;
}

/* ============================================================
   CANVAS: РИСОВАНИЕ РЕДАКТОРА
   ============================================================ */

/* Раньше на холсте ВЕЗДЕ был хардкод "DejaVu Sans Mono", даже если в инспекторе
   выбран другой шрифт (Unifont, свой .pf2 и т.п.) — выбор шрифта влиял только на
   экспорт в theme.txt, но не на то, что рисуется в редакторе/превью. Теперь холст
   действительно подставляет выбранное имя в CSS font-family (с фолбэком на моно),
   поэтому если у пользователя в ОС/браузере установлен шрифт с таким именем
   (Unifont довольно часто есть в системе на Linux, DejaVu Sans Mono — почти всегда),
   предпросмотр станет заметно ближе к реальному GRUB.
   ВАЖНО: это всё ещё приближение. GRUB рисует не CSS-шрифт, а конкретный растровый
   .pf2 побайтово — свою битмап-геометрию глифов, без хинтинга/антиалиасинга браузера.
   Полное 1:1 совпадение возможно только если сам распарсить .pf2 и рисовать глифы
   как пиксели на canvas — это отдельная большая фича, а не поправка стека шрифтов. */
function fontStackFor(name) {
  const n = (name || 'DejaVu Sans Mono').trim();
  const quoted = `"${n.replace(/"/g, '')}"`;
  const stack = [quoted];
  if (n !== 'DejaVu Sans Mono') stack.push('"DejaVu Sans Mono"');
  stack.push('"Cascadia Code"', '"Consolas"', 'monospace');
  return stack.join(',');
}

function drawEditor() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawThemeBackground(ctx, bgImage, canvas.width, canvas.height, theme.bgScaleMethod, theme.bgHAlign, theme.bgVAlign, bgColor);

  // terminal-box (глобальный, корневой элемент темы)
  if (theme.terminalVisible) {
    const tx = (theme.terminalLeft / 100) * canvas.width;
    const ty = (theme.terminalTop / 100) * canvas.height;
    const tw = (theme.terminalWidth / 100) * canvas.width;
    const th = (theme.terminalHeight / 100) * canvas.height;
    const drew = theme.terminalBoxImg && drawNinePatch(ctx, theme.terminalBoxImg, tx, ty, tw, th, theme.terminalBorder * scale, scale);
    // Тёмный fallback УДАЛЁН: реальный GRUB никогда не затемняет фон из-за
    // terminal-box. Если файлы паттерна не найдены — png-loader просто не
    // рисует бокс (как с terminal_box_*.png, которых нет в проекте).
    // Раньше редактор красил весь холст rgba(0,0,0,0.7), из-за чего фон
    // выглядел темнее, чем в настоящем GRUB.
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillText('terminal-box', tx + 6 * scale, ty + 14 * scale);
  }

  // title-text (глобальный, наверху по центру)
  if (theme.titleVisible && theme.titleText) {
    const titleParts = String(theme.titleFont || 'DejaVu Sans Mono Bold 28').match(/^(.*?)\s+(Bold|Regular|Italic|BoldItalic)\s+(\d+)$/i);
    const titleFontName = titleParts ? titleParts[1] : 'DejaVu Sans Mono';
    const titleSize = titleParts ? parseInt(titleParts[3], 10) : 28;
    const titleBold = titleParts ? /bold/i.test(titleParts[2]) : true;
    ctx.fillStyle = theme.titleColor;
    ctx.font = `${titleBold ? '600 ' : ''}${titleSize * scale}px ${fontStackFor(titleFontName)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(theme.titleText, canvas.width / 2, 20 * scale);
    ctx.textAlign = 'left';
  }

  layers.forEach(l => {
    if (!l.visible) return;
    drawLayerShape(ctx, l, scale);
  });

  const sel = getLayer(selectedId);
  if (sel) {
    ctx.strokeStyle = '#5b8a72';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(sel.x * scale, sel.y * scale, sel.w * scale, sel.h * scale);
    ctx.setLineDash([]);
    drawHandles(ctx, sel, scale);
  }
}

// 8 точек ресайза: 4 угла + 4 середины сторон
function getHandlePositions(l) {
  const { x, y, w, h } = l;
  return {
    nw: { x: x,       y: y       , cursor: 'nwse-resize' },
    n:  { x: x + w/2,  y: y       , cursor: 'ns-resize'   },
    ne: { x: x + w,    y: y       , cursor: 'nesw-resize' },
    e:  { x: x + w,    y: y + h/2 , cursor: 'ew-resize'   },
    se: { x: x + w,    y: y + h   , cursor: 'nwse-resize' },
    s:  { x: x + w/2,  y: y + h   , cursor: 'ns-resize'   },
    sw: { x: x,        y: y + h   , cursor: 'nesw-resize' },
    w:  { x: x,        y: y + h/2 , cursor: 'ew-resize'   },
  };
}

function drawHandles(c, l, sc) {
  const handles = getHandlePositions(l);
  c.fillStyle = '#5b8a72';
  Object.values(handles).forEach(p => {
    c.fillRect(p.x * sc - 4, p.y * sc - 4, 8, 8);
  });
}

function findHandleAt(l, x, y) {
  const handles = getHandlePositions(l);
  const tol = 8 / scale;
  for (const [key, p] of Object.entries(handles)) {
    if (Math.abs(x - p.x) < tol && Math.abs(y - p.y) < tol) return key;
  }
  return null;
}

function drawLayerShape(c, l, sc) {
  const x = l.x * sc, y = l.y * sc, w = l.w * sc, h = l.h * sc;

  if (l.type === 'menu') {
    const spacing = (l.itemSpacing || 0) * sc;
    const pad = (l.itemPadding || 0) * sc;
    const iconSpace = (l.itemIconSpace || 8) * sc;
    const fixedRowH = (l.itemHeight || 32) * sc;

    // рамка всего меню (menu_pixmap_style) — растягивается на весь контейнер как и раньше
    if (l.menuBorderImg) {
      drawNinePatch(c, l.menuBorderImg, x, y, w, h, (l.menuBorderBorder || 10) * sc, sc);
    }

    // GRUB (grub-core/gfxmenu/gui_list.c) рисует пункты от ВЕРХНЕГО края контейнера вниз,
    // без вертикального центрирования — если контейнер выше, чем нужно для всех строк,
    // лишнее пространство остаётся пустым снизу. Раньше здесь было центрирование блока
    // строк по вертикали "как будто в GRUB" — это неверно и давало расхождение с реальным рендером.
    const yOffset = 0;

    // GRUB (grub-core/gfxmenu/gui_list.c + widget-box.c): паддинги рамки menu_pixmap_style
    // равны максимальному натуральному размеру соответствующих кусков
    // (get_left_pad = max(w,nw,sw), get_top_pad = max(n,nw,ne) и т.д.), и ПУНКТЫ МЕНЮ
    // рисуются ВНУТРИ этих паддингов, а не от края контейнера. Иначе выделенная строка
    // перекрывает верхнюю/боковые линии рамки — выглядело «криво» и не как в GRUB.
    let boxPadL = 0, boxPadR = 0, boxPadT = 0, boxPadB = 0;
    if (l.menuBorderImg && typeof l.menuBorderImg === 'object') {
      const dim = (suf, isW) => {
        const img = imgCache[l.menuBorderImg[suf]];
        return (img && img.complete && img.naturalWidth) ? (isW ? img.naturalWidth : img.naturalHeight) : 0;
      };
      boxPadL = Math.max(dim('w', true), dim('nw', true), dim('sw', true)) * sc;
      boxPadR = Math.max(dim('e', true), dim('ne', true), dim('se', true)) * sc;
      boxPadT = Math.max(dim('n', false), dim('nw', false), dim('ne', false)) * sc;
      boxPadB = Math.max(dim('s', false), dim('sw', false), dim('se', false)) * sc;
    }

    const contentTop = y + boxPadT + yOffset;
    const availH = h - boxPadT - boxPadB - yOffset;

    // строки НЕ должны вылезать за нижний край рамки слоя: сколько реально влезает
    const fitCount = Math.max(1, Math.floor((availH + spacing) / (fixedRowH + spacing)));
    const shown = Math.min(
      l.maxItemsShown > 0 ? l.maxItemsShown : l.itemCount,
      l.itemCount,
      fitCount
    );

    for (let i = 0; i < shown; i++) {
      const ry = contentTop + i * (fixedRowH + spacing);
      const active = i === 0;
      const entry = osEntries[i];

      // ширина подложки пункта уменьшается на боковые паддинги (item_padding)
      // в реальном GRUB боковая рамка внутри строки
      const rowX = x + boxPadL + pad;
      const rowW = Math.max(0, w - boxPadL - boxPadR - pad * 2);
      const rowH = fixedRowH;
      const bgUrl = active ? l.menuSelectedBg : l.menuNormalBg;
      const bgBorder = ((active ? l.menuSelectedBorder : l.menuNormalBorder) || 6) * sc;
      bgUrl && drawNinePatch(c, bgUrl, rowX, ry, rowW, rowH, bgBorder, sc);
      // GRUB БЕЗ selected_item_pixmap_style НЕ рисует фон/рамку под выбранным пунктом —
      // он лишь красит текст в selected_item_color. Синий прямоугольник здесь был обманчив,
      // поэтому без заданной 9-patch подложки ничего не подкладываем, как в реальном GRUB.

      // GRUB: иконка выбирается по --class пункта меню, ищется как <class>.png в папке иконок
      // В редакторе: маппим иконку по порядку строки (1-я строка -> 1-я ос-запись и т.д.) но также
      // пробуем матчить по имени класса если в имени пункта есть подсказка
      let iconUrl = null;
      if (entry) {
        // если у записи есть отдельная выбранная иконка — используем её для active
        iconUrl = active ? (entry.selectedImg || entry.normalImg) : entry.normalImg;
      }
      // фолбэк: если у ос-записи иконки нет — берём из встроенной библиотеки
      // default-icons/ по --class записи (или по совпадению имени), как GRUB ищет
      // <class>.png в папке иконок темы
      if (entry && !iconUrl) {
        const cls = defaultIconClassFor(entry);
        if (cls) {
          iconUrl = getDefaultIconUrl(cls);
          cacheImage(iconUrl);
        }
      }
      // фолбэк: если у ос-записи иконки нет, но в fileMap есть совпадающая по классу
      const iconImg = iconUrl && imgCache[iconUrl] && imgCache[iconUrl].complete ? imgCache[iconUrl] : null;
      const iconW = (l.iconWidth || 32) * sc, iconH = (l.iconHeight || 32) * sc;
      let textX = rowX + 6 * sc;
      if (iconImg) {
        c.drawImage(iconImg, rowX + 4 * sc, ry + (rowH - iconH) / 2, iconW, iconH);
        textX = rowX + 4 * sc + iconW + iconSpace;
      } else if (entry && entry.name) {
        // даже если картинки нет — оставляем отступ как под иконку, чтобы как в GRUB
        textX = rowX + 4 * sc + iconW + iconSpace;
      }
      // GRUB рисует .pf2 битмап-шрифт — реальное имя шрифта задаётся в инспекторе (fontName)
      const fs = (active && l.selectedFontSize ? l.selectedFontSize : l.fontSize) * sc;
      c.fillStyle = active ? l.selectedColor : l.color;
      c.font = `${fs}px ${fontStackFor(l.fontName)}`;
      c.textBaseline = 'middle';
      const label = entry ? entry.name : `Пункт ${i + 1}`;
      c.save();
      c.beginPath();
      c.rect(rowX, ry, rowW, rowH);
      c.clip();
      let displayLabel = label;
      const avail = rowW - (textX - rowX) - 6 * sc;
      if (c.measureText(label).width > avail) {
        while (displayLabel.length > 1 && c.measureText(displayLabel + '…').width > avail) displayLabel = displayLabel.slice(0, -1);
        displayLabel += '…';
      }
      c.fillText(displayLabel, textX, ry + rowH / 2);
      c.restore();
    }

    // скроллбар (превью, если пунктов больше, чем помещается)
    if (l.scrollbarEnabled && l.itemCount > shown) {
      const barW = 8 * sc;
      const barX = l.scrollbarSlice === 'west' ? x - barW - 4 * sc
                 : l.scrollbarSlice === 'center' ? x + w / 2 - barW / 2
                 : x + w + 4 * sc;
      const trackY = y + (l.scrollbarTopPad || 0) * sc;
      const trackH = h - ((l.scrollbarTopPad || 0) + (l.scrollbarBottomPad || 0)) * sc;
      if (l.scrollbarFrameImg) {
        drawNinePatch(c, l.scrollbarFrameImg, barX, trackY, barW, trackH, 4 * sc, sc);
      } else {
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(barX, trackY, barW, trackH);
      }
      const thumbH = Math.max(20 * sc, trackH * (shown / l.itemCount));
      if (l.scrollbarThumbImg) {
        drawNinePatch(c, l.scrollbarThumbImg, barX, trackY, barW, thumbH, 4 * sc, sc);
      } else {
        c.fillStyle = l.selectedColor;
        c.fillRect(barX, trackY, barW, thumbH);
      }
    }
  }

  if (l.type === 'progress') {
    const frameDrawn = l.barStyleImg && drawNinePatch(c, l.barStyleImg, x, y, w, h, (l.barStyleBorder || 8) * sc, sc);
    if (!frameDrawn) {
      c.fillStyle = l.barBg;
      c.fillRect(x, y, w, h);
    }
    const fillW = w * ((typeof l._previewFrac === 'number') ? l._previewFrac : 0.62);
    // GRUB: value тает к 0 по мере отсчёта; без __timeout__ — статичное демо-значение редактора
    const hlDrawn = l.highlightStyleImg && drawNinePatch(c, l.highlightStyleImg, x, y, fillW, h, (l.highlightStyleBorder || 8) * sc, sc);
    if (!hlDrawn) {
      c.fillStyle = l.barColor;
      c.fillRect(x, y, fillW, h);
    } else if (l.highlightOverlay && frameDrawn) {
      // highlight_overlay: заливка рисуется поверх, с наложением скруглений рамки
      drawNinePatch(c, l.barStyleImg, x, y, w, h, (l.barStyleBorder || 8) * sc, sc);
    }
    if (!frameDrawn && !l.highlightStyleImg) {
      // GRUB (gui_progress_bar.c, draw_filled_rect_bar): в ПЛОСКОМ режиме (нет ни
      // bar_style, ни highlight_style) рисуется рамка 1px цветом border_color
      // (по умолчанию чёрный), а заливка идёт с отступом 1px. В pixmap-режиме
      // (как в этой теме — highlight_style задан) рамки НЕ рисуется вовсе:
      // bar_box пустой и ничего не блитит. Прежняя декоративная белая обводка
      // rgba(255,255,255,0.15) в GRUB отсутствовала — убрана.
      const bc = (l.hasBorderColor && l.barBorderColor) ? l.barBorderColor : '#000000';
      c.fillStyle = bc;
      c.fillRect(x, y, w, 1);
      c.fillRect(x, y + h - 1, w, 1);
      c.fillRect(x, y, 1, h);
      c.fillRect(x + w - 1, y, 1, h);
    }
    if (l.showBarText) {
      c.fillStyle = l.barTextColor || '#ffffff';
      c.font = `${Math.max(10, (l.barFontSize || 16) * sc)}px ${fontStackFor(l.barFontName || l.fontName)}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const displayText = l.barText.replace('%d', '7');
      c.fillText(displayText, x + w / 2, y + h / 2);
      c.textAlign = 'left';
    }
  }

  if (l.type === 'circular') {
    /* Точный рендер по GRUB gui_circular_progress.c, circprog_paint():
       center blit: (width-center_width)/2, (height-center_height)/2 — НАТУРАЛЬНЫЙ размер
       ticks_shown = ticks_disappear ? end - value : value - start
       step = 256/num_ticks (256 единиц = полный круг), старт с start_angle (по умолчанию -64 = 12 часов)
       x = width/2  - tick_w/2 + (width/2  - tick_w/2) * cos(a); y = height/2 - tick_h/2 + (height/2 - tick_h/2) * sin(a) */
    const numTicks = Math.max(1, l.numTicks || 64);
    const startUnits = (typeof l.startAngle === 'number') ? l.startAngle : -64; // единицы GRUB: 256 = круг
    const startRad = startUnits * Math.PI * 2 / 256;
    const tickImg = l.tickBitmap && imgCache[l.tickBitmap];
    // сколько тиков видно: статичный макет — 60%; в превью приходит _previewShown
    const frac = (typeof l._previewShown === 'number') ? l._previewShown : 0.6;
    const shown = Math.max(0, Math.min(numTicks, Math.round(numTicks * frac)));

    if (tickImg && tickImg.complete && tickImg.naturalWidth) {
      // тики рисуются картинками ПО НАТУРАЛЬНОМУ размеру (GRUB не масштабирует)
      const tw = tickImg.naturalWidth, th = tickImg.naturalHeight;
      const rx = Math.max(1, w / 2 - tw / 2), ry = Math.max(1, h / 2 - th / 2);
      for (let i = 0; i < shown; i++) {
        const a = startRad + (i / numTicks) * Math.PI * 2; // step = 2π/numTicks
        c.drawImage(tickImg,
          x + w / 2 - tw / 2 + rx * Math.cos(a),
          y + h / 2 - th / 2 + ry * Math.sin(a));
      }
    }

    const centerImg = l.centerBitmap && imgCache[l.centerBitmap];
    if (centerImg && centerImg.complete && centerImg.naturalWidth) {
      // центр — натуральный размер, по центру компонента (как blit в GRUB)
      c.drawImage(centerImg, x + (w - centerImg.naturalWidth) / 2, y + (h - centerImg.naturalHeight) / 2);
    }
    // ВАЖНО: в реальном GRUB circular_progress рисуется ТОЛЬКО через center_bitmap/tick_bitmap.
    // Без них компонент невидим и текста в центре не бывает — это не progress_bar.
    // Пунктирная плашка ниже — только editor-guide, чтобы было видно место компонента.
    if (!tickImg && !centerImg) {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.setLineDash([4, 3]);
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.font = `${Math.max(9, r * 0.35)}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('нет картинок', cx, cy);
      c.textAlign = 'left';
    }
  }

  if (l.type === 'label') {
    c.fillStyle = l.color;
    // GRUB рисует PF2 bitmap-шрифты — по умолчанию Unifont/DejaVu Sans Mono, БЕЗ автоматической жирности.
    // "600 sans-serif" визуально шире/жирнее реального рендера и сдвигает раскладку — убираем оба искажения.
    c.font = `${l.fontBold ? '600 ' : ''}${l.fontSize * sc}px ${fontStackFor(l.fontName)}`;
    c.textBaseline = 'top';
    const align = l.align || 'left';
    c.textAlign = align;
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
    c.fillText(l.text, tx, y);
    c.textAlign = 'left';
  }

  if (l.type === 'box') {
    c.fillStyle = l.boxColor;
    c.fillRect(x, y, w, h);
    c.strokeStyle = l.boxBorder;
    c.lineWidth = Math.max(1, 2 * sc);
    c.strokeRect(x, y, w, h);
  }

  if (l.type === 'image') {
    const img = l.imgUrl && imgCache[l.imgUrl];
    if (img && img.complete) {
      c.drawImage(img, x, y, w, h);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.setLineDash([4, 3]);
      c.strokeRect(x, y, w, h);
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.font = `${Math.min(w, h) * 0.25}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🖼', x + w / 2, y + h / 2);
      c.textAlign = 'left';
    }
  }
}

/* ============================================================
   КОНФИГУРАЦИЯ ПУНКТОВ МЕНЮ (обычная / выбранная иконка на пункт)
   ============================================================ */

/* Встроенная библиотека иконок (папка default-icons/ рядом с editor.js).
   Иконка подставляется ос-записи автоматически по --class:
   default-icons/<class>.png — как GRUB ищет <class>.png в папке иконок. */
const DEFAULT_ICON_CLASSES = ['4MLinux','AlpineLinux','android','anonymous','antergos','arch','archcraft','archlinux','arcolinux','artix','brunch-settings','brunch','cachyos','cancel','chakra','debian','deepin','devuan','driver','edit','efi','elementary','endeavouros','fedora','find.efi','find.none','freebsd','gentoo','gnu-linux','gpart','haiku','help','hotpe','kali','kaos','kbd','kernel','korora','kubuntu','lang','lfs','lightpe','linux','linuxmint','lubuntu','macosx','macos','osx','mageia','Manjaro.i686','manjaro','Manjaro.x86_64','manjarolinux','memtest','memtest86','memtest86+','mx-linux','neon','nixos','opensuse','openwrt','parrot','pop-os','pop','recovery','regolith','restart','shutdown','siduction','solus','steamos','submenu','SystemRescueCD','type','tz','ubuntu','ubuntuDDE','unknown','unset','void','vtoyvhd','vtoywim','windows','windows11','xubuntu','zorin'];

// алиасы имён классов -> каноническое имя файла/библиотеки (варианты, которые
// генерирует grub.cfg/os-prober): GRUB ищет icons/<класс>.png по ТОЧНОМУ имени,
// поэтому без файла-алиаса пункт молча рисуется без иконки.
const ICON_CLASS_ALIASES = {
  macos: 'macosx',
  osx: 'macosx',
  mac: 'macosx',
  'memtest86': 'memtest',
  'memtest86+': 'memtest',
};

function defaultIconClassFor(e) {
  const norm = s => String(s || '').trim().toLowerCase().replace(/\.png$/, '');
  const cands = [e.osClass, e.name];
  for (const cand of cands) {
    if (!cand) continue;
    const n = norm(cand);
    // алиасы классов: реальный grub.cfg использует варианты имён (macos, osx),
    // а файл/библиотека — каноническое имя (macosx). GRUB ищет точное имя файла,
    // поэтому маппим вариант на канонический класс библиотеки.
    const alias = ICON_CLASS_ALIASES[n];
    if (alias) return alias;
    const hit = DEFAULT_ICON_CLASSES.find(c => norm(c) === n);
    if (hit) return hit;
  }
  return null;
}

/* URL дефолтной иконки: сначала ВСТРОЕННЫЕ data-URL из default-icons-data.js —
   они работают при открытии index.html как file:// без всякого сервера
   (fetch() на file:// запрещён, а canvas с file://-картинкой tainted и toBlob/toDataURL
   кидают SecurityError — поэтому внешний путь был только запасным вариантом). */
function getDefaultIconUrl(cls) {
  if (typeof DEFAULT_ICONS_DATA !== 'undefined' && DEFAULT_ICONS_DATA && DEFAULT_ICONS_DATA[cls]) {
    return DEFAULT_ICONS_DATA[cls];
  }
  return `default-icons/${cls}.png`;
}

/* Дефолтные иконки в экспорт: относительный путь default-icons/... нельзя отдать
   напрямую в сборщик ZIP (fetch() на file:// запрещён), поэтому конвертируем PNG
   в dataURL через canvas — data: URL fetch() берёт без проблем.
   Встроенные data-URL (DEFAULT_ICONS_DATA) берутся сразу, без конвертации. */
const _defaultIconDataUrlCache = {};
function loadDefaultIconDataUrl(cls) {
  if (cls in _defaultIconDataUrlCache) return Promise.resolve(_defaultIconDataUrlCache[cls]);
  const embedded = (typeof DEFAULT_ICONS_DATA !== 'undefined' && DEFAULT_ICONS_DATA) ? DEFAULT_ICONS_DATA[cls] : null;
  if (embedded) { _defaultIconDataUrlCache[cls] = embedded; return Promise.resolve(embedded); }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        _defaultIconDataUrlCache[cls] = cv.toDataURL('image/png');
      } catch (err) { _defaultIconDataUrlCache[cls] = null; }
      resolve(_defaultIconDataUrlCache[cls]);
    };
    img.onerror = () => { _defaultIconDataUrlCache[cls] = null; resolve(null); };
    img.src = `default-icons/${cls}.png`;
  });
}

// пресет = ВСЯ встроенная библиотека иконок: слева в конфигурации сразу
// видны все default-icons/*.png, и всё настроенное здесь уходит в билд
function defaultOsEntries() {
  return DEFAULT_ICON_CLASSES.map((cls, i) => ({
    id: i + 1, name: cls, osClass: cls, normalImg: null, selectedImg: null
  }));
}

let osEntries = defaultOsEntries();
let osIdCounter = defaultOsEntries().length + 1;

// кнопка «Импортировать все иконки»: добавляет весь пресет default-icons/
// (классы, которых ещё нет в списке — дубликаты не плодит)
function importAllPresetIcons() {
  const have = new Set(osEntries.map(e => e.osClass));
  const missing = DEFAULT_ICON_CLASSES.filter(c => !have.has(c));
  if (!missing.length) return;
  missing.forEach(cls => osEntries.push({ id: osIdCounter++, name: cls, osClass: cls, normalImg: null, selectedImg: null }));
  renderOsConfig();
  if (!getLayer(selectedId)) renderInspector(); else drawEditor();
}
// кнопка «Удалить все иконки»
function clearAllOsEntries() {
  if (!osEntries.length || !confirm('Удалить все записи иконок OS?')) return;
  osEntries = [];
  renderOsConfig();
  if (!getLayer(selectedId)) renderInspector(); else drawEditor();
}

// сколько строк показывает меню загрузки (по всем menu-слоям)
function getMenuRowsCount() {
  let n = 0;
  layers.filter(l => l.type === 'menu').forEach(l => { n = Math.max(n, l.itemCount || 0); });
  return n;
}

function addOsEntry() {
  osEntries.push({ id: osIdCounter++, name: 'Новая запись', osClass: 'os', normalImg: null, selectedImg: null });
  renderOsConfig();
  drawEditor();
  if (!getLayer(selectedId)) renderInspectorOsSection();
}
function removeOsEntry(id) {
  osEntries = osEntries.filter(e => e.id !== id);
  renderOsConfig();
  drawEditor();
  if (!getLayer(selectedId)) renderInspectorOsSection();
}

function ensureOsConfigBtn(){}
// легаси: отдельная нижняя панель os-config удалена — иконки ОС живут
// только в инспекторе (renderInspectorOsSection). Заглушка оставлена,
// т.к. renderOsConfig() вызывается из старых мест.
function renderOsConfig() {}

// btn создаётся динамически в ensureOsConfigBtn

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// точечное обновление слота иконки одной записи (лейбл + картинка) без
// пересборки всей панели — чтобы не терять фокус ввода имени/класса
function refreshOsEntryView(div, e) {
  if (!div) return;
  const label = div.querySelector('.slot-label');
  if (label) label.textContent = 'Иконка (icons/' + (e.osClass || 'class') + '.png)';
  const box = div.querySelector('.slot-box');
  if (box) box.innerHTML = e.normalImg
    ? `<img src="${e.normalImg}">`
    : (defaultIconClassFor(e)
        ? `<img src="${getDefaultIconUrl(defaultIconClassFor(e))}" style="opacity:.85;" title="встроенная иконка (default-icons/${escapeHtml(defaultIconClassFor(e))}.png) — клик, чтобы заменить своей">`
        : '＋');
}

/* ============================================================
   ВЗАИМОДЕЙСТВИЕ С CANVAS: drag / resize (8 точек) / контекстное меню
   ============================================================ */

let dragMode = null; // 'move' | 'resize' | null
let resizeHandle = null;
let dragStart = { x: 0, y: 0 };
let layerStart = null;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const { x, y } = toStageCoords(e);
  const sel = getLayer(selectedId);
  if (sel) {
    const handle = findHandleAt(sel, x, y);
    if (handle) {
      dragMode = 'resize';
      resizeHandle = handle;
      dragStart = { x, y };
      layerStart = { ...sel };
      return;
    }
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) {
      selectedId = l.id;
      dragMode = 'move';
      dragStart = { x, y };
      layerStart = { ...l };
      renderAll();
      return;
    }
  }
  selectedId = null;
  renderAll();
});

window.addEventListener('mousemove', (e) => {
  if (!dragMode) {
    // курсор-подсказка при наведении на хендл
    const sel = getLayer(selectedId);
    if (sel && e.target === canvas) {
      const { x, y } = toStageCoords(e);
      const handle = findHandleAt(sel, x, y);
      const handles = getHandlePositions(sel);
      canvas.style.cursor = handle ? handles[handle].cursor : 'default';
    }
    return;
  }
  const { x, y } = toStageCoords(e);
  const l = getLayer(selectedId);
  if (!l) return;
  const dx = x - dragStart.x, dy = y - dragStart.y;

  if (dragMode === 'move') {
    l.x = Math.round(layerStart.x + dx);
    l.y = Math.round(layerStart.y + dy);
  } else if (dragMode === 'resize') {
    applyResize(l, layerStart, resizeHandle, dx, dy);
  }
  renderAll();
});

function applyResize(l, start, handle, dx, dy) {
  let { x, y, w, h } = start;
  const minSize = 16;
  if (handle.includes('e')) w = Math.max(minSize, start.w + dx);
  if (handle.includes('s')) h = Math.max(minSize, start.h + dy);
  if (handle.includes('w')) { w = Math.max(minSize, start.w - dx); x = start.x + (start.w - w); }
  if (handle.includes('n')) { h = Math.max(minSize, start.h - dy); y = start.y + (start.h - h); }
  l.x = Math.round(x); l.y = Math.round(y); l.w = Math.round(w); l.h = Math.round(h);
  if (l.type === 'image') l.imgAutoSize = false; // ручной ресайз отменяет авто-размер по исходной картинке
}

window.addEventListener('mouseup', () => { dragMode = null; resizeHandle = null; layerStart = null; });

// средняя кнопка (колесо) — панорамирование холста, как в Figma/Photoshop
(function(){
  const wrap = document.getElementById('canvas-wrap');
  if(!wrap) return;
  let panning=false, startX=0, startY=0, startSL=0, startST=0;
  // блокируем скролл боком при клике колесом
  wrap.addEventListener('auxclick', e=>{ if(e.button===1) e.preventDefault(); });
  wrap.addEventListener('mousedown', e=>{
    if(e.button!==1) return;
    e.preventDefault();
    panning=true;
    startX=e.clientX; startY=e.clientY;
    startSL=wrap.scrollLeft; startST=wrap.scrollTop;
    wrap.classList.add('panning');
  });
  window.addEventListener('mousemove', e=>{
    if(!panning) return;
    wrap.scrollLeft = startSL - (e.clientX - startX);
    wrap.scrollTop  = startST - (e.clientY - startY);
  });
  window.addEventListener('mouseup', e=>{
    if(e.button===1 || panning){
      panning=false;
      wrap.classList.remove('panning');
    }
  });
})();

function toStageCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  return { x: px / scale, y: py / scale };
}

/* ---------- контекстное меню правого клика ---------- */

let ctxMenuStagePos = { x: 0, y: 0 };
let ctxMenuLayerId = null;
function hitLayerAt(x, y) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
  }
  return null;
}
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ctxMenuStagePos = toStageCoords(e);
  const hit = hitLayerAt(ctxMenuStagePos.x, ctxMenuStagePos.y);
  ctxMenuLayerId = hit ? hit.id : null;
  if (hit) selectedId = hit.id;
  const menu = document.getElementById('ctx-menu');
  const layerActions = document.getElementById('ctx-layer-actions');
  const layerName = document.getElementById('ctx-layer-name');
  const addActions = document.getElementById('ctx-add-actions');
  const sepCanvas = document.getElementById('ctx-sep-canvas');
  const canvasProps = document.getElementById('ctx-canvas-props');
  if (hit) {
    const idx = layers.findIndex(l => l.id === hit.id);
    const atTop = idx === layers.length - 1;
    const atBottom = idx === 0;
    layerActions.style.display = 'block';
    addActions.style.display = 'none';
    sepCanvas.style.display = 'none';
    canvasProps.style.display = 'none';
    layerName.textContent = hit.name + (hit.visible ? '' : ' (скрыт)');
    layerActions.querySelectorAll('[data-ctx]').forEach(el => {
      const c = el.getAttribute('data-ctx');
      el.classList.remove('disabled');
      if ((c === 'front' || c === 'forward') && atTop) el.classList.add('disabled');
      if ((c === 'back' || c === 'backward') && atBottom) el.classList.add('disabled');
    });
  } else {
    layerActions.style.display = 'none';
    addActions.style.display = 'block';
    sepCanvas.style.display = 'block';
    canvasProps.style.display = 'block';
  }
  menu.style.left = Math.min(e.clientX, window.innerWidth - 230) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 320) + 'px';
  menu.classList.add('show');
  if (hit) renderAll();
});
window.addEventListener('click', (e) => {
  if (!e.target.closest('#ctx-menu')) document.getElementById('ctx-menu').classList.remove('show');
});
// ПКМ по пустому пространству ВОКРУГ макета (workspace, панели-обёртки и т.п.)
// тоже открывает меню вставки — вместо нативного меню браузера. Точка вставки
// клампится в границы холста, чтобы новый слой появился внутри макета.
// Правый клик по элементам UI (инпуты, другие меню, тулбар, список слоёв)
// оставляет браузерное поведение.
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return; // свой обработчик (canvas/список слоёв) уже сработал
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('#ctx-menu, #ctx-add-actions, .menu-dropdown, #top-toolbar, #layer-list, #inspector-wrap, #project-panel, #panel-right, input, textarea, select, button, [contenteditable]')) return;
  e.preventDefault();
  ctxMenuLayerId = null;
  try {
    const sp = toStageCoords(e);
    ctxMenuStagePos = {
      x: Math.max(0, Math.min(STAGE_W, sp.x)),
      y: Math.max(0, Math.min(STAGE_H, sp.y)),
    };
  } catch (err) {
    ctxMenuStagePos = { x: STAGE_W / 2, y: STAGE_H / 2 };
  }
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-layer-actions').style.display = 'none';
  document.getElementById('ctx-add-actions').style.display = 'block';
  document.getElementById('ctx-sep-canvas').style.display = 'block';
  document.getElementById('ctx-canvas-props').style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 230) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 320) + 'px';
  menu.classList.add('show');
});
document.querySelectorAll('#ctx-menu [data-add]').forEach(item => {
  item.addEventListener('click', () => {
    if(item.classList.contains('disabled')) return;
    const type = item.getAttribute('data-add');
    addLayer(type, Math.round(ctxMenuStagePos.x - 60), Math.round(ctxMenuStagePos.y - 20));
    document.getElementById('ctx-menu').classList.remove('show');
  });
});
document.getElementById('ctx-canvas-props').addEventListener('click', () => {
  document.getElementById('ctx-menu').classList.remove('show');
  openCanvasProps();
});
document.querySelectorAll('#ctx-layer-actions [data-ctx]').forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('disabled')) return;
    const act = item.getAttribute('data-ctx');
    if (!ctxMenuLayerId) return;
    if (act === 'front' || act === 'back' || act === 'forward' || act === 'backward') reorderLayer(ctxMenuLayerId, act);
    else if (act === 'duplicate') duplicateLayer(ctxMenuLayerId);
    else if (act === 'delete') removeLayer(ctxMenuLayerId);
    document.getElementById('ctx-menu').classList.remove('show');
  });
});
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !e.target.matches('input, textarea, select')) {
    e.preventDefault();
    removeLayer(selectedId);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedId && !e.target.matches('input, textarea')) {
    e.preventDefault();
    duplicateLayer(selectedId);
  }
});

/* ============================================================
   ПАНЕЛЬ СЛОЁВ
   ============================================================ */

function renderLayerList() {
  const list = document.getElementById('layer-list');
  list.innerHTML = '';
  if (layers.length === 0) {
    list.innerHTML = '<div class="empty-msg">Слоёв нет.<br>ПКМ по холсту или кнопки сверху.</div>';
    return;
  }
  const ordered = [...layers].reverse();
  ordered.forEach(l => {
    const div = document.createElement('div');
    div.className = 'layer-item' + (l.id === selectedId ? ' active' : '') + (!l.visible ? ' hidden' : '');
    div.draggable = true;
    div.dataset.layerId = String(l.id);
    div.innerHTML = `
      <span class="icon">${layerIcon(l.type)}</span>
      <span class="name">${escapeHtml(l.name)}</span>

      <span class="vis" data-act="toggle">${l.visible ? '👁' : '—'}</span>
      <span class="vis" data-act="del">✕</span>
    `;
    div.addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act');
      if (act === 'toggle') { l.visible = !l.visible; renderAll(); return; }
      if (act === 'del') { removeLayer(l.id); return; }
      selectedId = l.id;
      renderAll();
    });
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      selectedId = l.id; renderAll();
      ctxMenuStagePos = { x: l.x + l.w/2, y: l.y + l.h/2 };
      ctxMenuLayerId = l.id;
      const menu = document.getElementById('ctx-menu');
      const la = document.getElementById('ctx-layer-actions');
      const ad = document.getElementById('ctx-add-actions');
      const se = document.getElementById('ctx-sep-canvas');
      const cp = document.getElementById('ctx-canvas-props');
      const ln = document.getElementById('ctx-layer-name');
      const idx = layers.findIndex(x=>x.id===l.id);
      const atTop = idx===layers.length-1, atBottom = idx===0;
      la.style.display='block'; ad.style.display='none'; se.style.display='none'; cp.style.display='none';
      ln.textContent = l.name + (l.visible?'':' (скрыт)');
      la.querySelectorAll('[data-ctx]').forEach(el=>{
        const c=el.getAttribute('data-ctx'); el.classList.remove('disabled');
        if((c==='front'||c==='forward')&&atTop) el.classList.add('disabled');
        if((c==='back'||c==='backward')&&atBottom) el.classList.add('disabled');
      });
      menu.style.left=Math.min(e.clientX, window.innerWidth-230)+'px';
      menu.style.top=Math.min(e.clientY, window.innerHeight-320)+'px';
      menu.classList.add('show');
    });
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', String(l.id));
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      list.querySelectorAll('.layer-item').forEach(el=>el.classList.remove('drop-before','drop-after'));
    });
    div.addEventListener('dragover', (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      const rect=div.getBoundingClientRect();
      const before=(e.clientY-rect.top)<rect.height/2;
      list.querySelectorAll('.layer-item').forEach(el=>el.classList.remove('drop-before','drop-after'));
      div.classList.add(before?'drop-before':'drop-after');
    });
    div.addEventListener('dragleave', ()=> div.classList.remove('drop-before','drop-after'));
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId=Number(e.dataTransfer.getData('text/plain'));
      if(!draggedId||draggedId===l.id) return;
      const rect=div.getBoundingClientRect();
      const before=(e.clientY-rect.top)<rect.height/2;
      const visual=[...layers].reverse();
      const vDrag=visual.findIndex(x=>x.id===draggedId);
      if(vDrag===-1) return;
      const [dragged]=visual.splice(vDrag,1);
      const vTarget=visual.findIndex(x=>x.id===l.id);
      const insertAt=before? vTarget : vTarget+1;
      visual.splice(insertAt,0,dragged);
      layers.length=0; visual.reverse().forEach(x=>layers.push(x));
      list.querySelectorAll('.layer-item').forEach(el=>el.classList.remove('drop-before','drop-after'));
      renderAll();
    });
    list.appendChild(div);
  });
}

function layerIcon(type) {
  return { menu: '☰', progress: '▬', circular: '◐', label: 'T', box: '▢', image: '🖼' }[type] || '•';
}

/* ============================================================
   ИНСПЕКТОР (правая панель свойств выбранного слоя)
   ============================================================ */

function buildOsConfigHtml() {
  if (osEntries.length === 0) return '<div class="empty-msg">Нет записей OS. Добавьте кнопкой «+» в заголовке.</div>';
  return osEntries.map(e => `
      <div class="os-entry" data-os-id="${e.id}">
        <div class="os-entry-head">
          <input type="text" value="${escapeHtml(e.name)}" data-os-name="${e.id}">
          <span class="os-del" data-os-del="${e.id}">✕</span>
        </div>
        <div class="field" style="padding:0 0 6px;">
          <label style="font-size:10.5px;color:var(--text-2);">Класс (--class)</label>
          <input type="text" value="${escapeHtml(e.osClass || '')}" data-os-class="${e.id}" placeholder="ubuntu, windows...">
        </div>
        <div class="slot-row">
          <div class="slot">
            <div class="slot-label">Иконка (icons/${escapeHtml(e.osClass || 'class')}.png)</div>
            <div class="slot-box" data-os-normal="${e.id}">${e.normalImg
              ? `<img src="${e.normalImg}">`
              : (defaultIconClassFor(e)
                  ? `<img src="${getDefaultIconUrl(defaultIconClassFor(e))}" style="opacity:.85;" title="встроенная иконка (default-icons/${escapeHtml(defaultIconClassFor(e))}.png) — клик, чтобы заменить своей">`
                  : '＋')}</div>
          </div>
        </div>
      </div>
    `).join('');
}
function bindOsConfigEvents(root) {
  root.querySelectorAll('[data-os-import-all]').forEach(btn => btn.addEventListener('click', importAllPresetIcons));
  root.querySelectorAll('[data-os-clear-all]').forEach(btn => btn.addEventListener('click', clearAllOsEntries));
  root.querySelectorAll('[data-os-name]').forEach(inp => {
    const id = Number(inp.getAttribute('data-os-name'));
    const e = osEntries.find(x => x.id === id);
    if (!e) return;
    inp.addEventListener('input', () => {
      e.name = inp.value; drawEditor();
      refreshOsEntryView(inp.closest('.os-entry'), e);
    });
    inp.addEventListener('blur', () => renderAll());
  });
  root.querySelectorAll('[data-os-del]').forEach(btn => {
    btn.addEventListener('click', () => removeOsEntry(Number(btn.getAttribute('data-os-del'))));
  });
  root.querySelectorAll('[data-os-class]').forEach(inp => {
    const id = Number(inp.getAttribute('data-os-class'));
    const e = osEntries.find(x => x.id === id);
    if (!e) return;
    inp.addEventListener('input', () => {
      e.osClass = inp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
      // живо обновляем слот иконки, не перестраивая панель (иначе слетает фокус ввода)
      refreshOsEntryView(inp.closest('.os-entry'), e);
    });
    inp.addEventListener('blur', () => renderAll());
  });
  // клик по иконке — скрытый file input
  root.querySelectorAll('[data-os-normal]').forEach(box => {
    box.addEventListener('click', () => {
      const id = Number(box.getAttribute('data-os-normal'));
      const e = osEntries.find(x => x.id === id);
      if (!e) return;
      const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*';
      inp.onchange = ev => { const f=ev.target.files[0]; if(!f) return; handlePickedImageFile(f, (url) => { e.normalImg=url; e.selectedImg=url; cacheImage(url); renderAll(); renderOsConfig(); if(!getLayer(selectedId)) renderInspectorOsSection(); }); };
      inp.click();
    });
  });
}
// HTML секции «иконки ОС» внутри инспектора (когда слой не выбран)
function inspectorOsSectionHtml() {
  return '<div class="field-group" style="border-bottom:none;" id="inspector-os-group">'
    + '<h4>Конфигурация проекта (иконки ОС)</h4>'
    + '<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px;">'
    + '<button data-os-import-all class="os-head-btn" style="padding:3px 10px;">Импортировать все иконки</button>'
    + '<button data-os-clear-all class="os-head-btn" style="padding:3px 10px;">Удалить все иконки</button>'
    + '<button id="inspector-add-os" class="os-head-btn" style="padding:3px 10px;">+ Добавить пункт</button>'
    + '</div>'
    + buildOsConfigHtml() + '</div>';
}
function bindInspectorOsSection() {
  const grp = document.getElementById('inspector-os-group');
  if (!grp) return;
  bindOsConfigEvents(grp);
  grp.querySelector('#inspector-add-os')?.addEventListener('click', addOsEntry);
}
// перерисовывает ТОЛЬКО секцию иконок ОС в инспекторе, не трогая остальное
// содержимое панели — нужно когда фокус внутри инспектора (renderAll
// пропускает полный renderInspector, чтобы не слетал ввод текста)
function renderInspectorOsSection() {
  const old = document.getElementById('inspector-os-group');
  if (!old) { renderInspector(); return; }
  old.outerHTML = inspectorOsSectionHtml();
  bindInspectorOsSection();
}

function renderInspector() {
  const el = document.getElementById('inspector-body');
  const l = getLayer(selectedId);
  if (!l) {
    // когда ничего не выбрано — показываем иконки ОС прямо в панели свойств, внизу панели не дублируем
    el.innerHTML = inspectorOsSectionHtml();
    bindInspectorOsSection();
    return;
  }

  let fields = `
    <div class="field-group">
      <h4>Позиция и размер</h4>
      <div class="row2">
        <div class="field"><label>X</label><input type="number" data-k="x" value="${l.x}"></div>
        <div class="field"><label>Y</label><input type="number" data-k="y" value="${l.y}"></div>
      </div>
      <div class="row2" style="margin-top:6px;">
        <div class="field"><label>Ширина</label><input type="number" data-k="w" value="${l.w}"></div>
        <div class="field"><label>Высота</label><input type="number" data-k="h" value="${l.h}"></div>
      </div>
    </div>
  `;

  if (l.type === 'menu') {
    const needFonts = projectFontFiles().filter(x => x.font.startsWith((l.fontName || 'DejaVu Sans Mono') + ' '));
    fields += `
      <div class="field-group">
        <h4>Меню загрузки</h4>
        <div class="hint-small">Подложка строки: в GRUB это <b>только</b> PNG-рамка (item_pixmap_style / selected_item_pixmap_style). Заливка цветом «как в редакторе» без картинки в GRUB невозможна — задайте 9-patch ниже.</div>
        <div class="field"><label>Видно одновременно (max_items_shown)</label><input type="number" data-k="maxItemsShown" value="${l.maxItemsShown}" min="0" title="0 = показывать все"></div>
        <div class="hint-small">0 = показывать всё.</div>
        <div class="field"><label>Размер шрифта (px)</label><input type="number" data-k="fontSize" value="${l.fontSize}" min="8" max="96"></div>
        ${l.itemFontRef
          ? `<div class="hint-small">✓ Привязан к реальному файлу: <b>${escapeHtml(l.itemFontRef)}</b></div>`
          : `<div class="hint-small">⚠ Реального .pf2 не загружено — в GRUB будет встроенный шрифт.</div>`}
        <div class="field"><label>Шрифт пунктов</label>
          <select data-k="fontName">
            ${['DejaVu Sans Mono', 'DejaVu Sans', 'Unifont', ...projectFonts.map(f=>f.name.replace(/\s+(Bold|Regular|Italic|BoldItalic)\s+\d+$/i,'')).filter((v,i,a)=>a.indexOf(v)===i)].filter((v,i,a)=>a.indexOf(v)===i).map(n => `<option value="${n}" ${ (l.fontName||'DejaVu Sans Mono')===n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label></label><button data-action="upload-menu-font" style="width:100%;">+ Загрузить свой шрифт .pf2</button></div>
        <div class="hint-small">В GRUB работают только .pf2-шрифты. ${needFonts.length ? `Нужны в ZIP: ${needFonts.map(x => `<b>${x.file}</b>`).join(', ')}.` : 'Загрузите свой .pf2, иначе будет встроенный шрифт.'}</div>
        <div class="field"><label>Шрифт выбранного (px, 0 = как у пунктов)</label><input type="number" data-k="selectedFontSize" value="${l.selectedFontSize || 0}" min="0" max="96"></div>
        ${l.hasSeparateSelectedFont && l.selectedItemFontRef
          ? `<div class="hint-small">✓ Привязан к реальному файлу: <b>${escapeHtml(l.selectedItemFontRef)}</b>. Изменение размера сбросит привязку.</div>`
          : (l.selectedFontSize ? `<div class="hint-small">⚠ Реального .pf2 под этот размер не загружено — приближение.</div>` : '')}
        <div class="field"><label>Цвет текста</label><input type="color" data-k="color" value="${l.color}"></div>
        <div class="field"><label>Цвет выбранного</label><input type="color" data-k="selectedColor" value="${l.selectedColor}"></div>
        <div class="field"><label><b>item_height</b> (высота/толщина пункта, px)</label><input type="number" data-k="itemHeight" value="${l.itemHeight || 32}" min="8" max="300"></div>
        <div class="field"><label>item_padding</label><input type="number" data-k="itemPadding" value="${l.itemPadding}"></div>
        <div class="hint-small">Горизонтальный отступ пунктов от левого/правого края рамки меню (не толщина строки).</div>
        <div class="field"><label>item_spacing</label><input type="number" data-k="itemSpacing" value="${l.itemSpacing}"></div>
        <div class="field"><label>item_icon_space</label><input type="number" data-k="itemIconSpace" value="${l.itemIconSpace}"></div>
        <div class="field"><label>Ширина иконки (icon_width)</label><input type="number" data-k="iconWidth" value="${l.iconWidth || 32}" min="0"></div>
        <div class="field"><label>Высота иконки (icon_height)</label><input type="number" data-k="iconHeight" value="${l.iconHeight || 32}" min="0"></div>
        <div class="hint-small">Иконки для пунктов задаются в «Конфигурация проекта (иконки ОС)» слева. Порядок записей соответствует порядку строк меню.</div>
      </div>
      <div class="field-group">
        <h4>Рамка меню (menu_pixmap_style)</h4>
        ${nineSlotHtml('menu-border', l.menuBorderImg, 'Рамка вокруг всего меню (9-patch)', l.menuBorderPattern)}
      </div>
      <div class="field-group">
        <h4>Подложка пункта (9-patch, необязательно)</h4>
        ${nineSlotHtml('menu-normal-bg', l.menuNormalBg, 'Обычный пункт — рамка', l.menuNormalPattern)}
        ${nineSlotHtml('menu-selected-bg', l.menuSelectedBg, 'Выбранный пункт — рамка', l.menuSelectedPattern)}
        <div class="hint-small">Без картинки GRUB подложку НЕ рисует вообще — выбранный пункт отличается только цветом текста (selected_item_color).</div>
      </div>
      <div class="field-group">
        <h4>Скроллбар</h4>
        <div class="field"><label>Включён</label><input type="checkbox" data-k="scrollbarEnabled" data-type="checkbox" ${l.scrollbarEnabled ? 'checked' : ''}></div>
        ${l.scrollbarEnabled ? `
          ${nineSlotHtml('scrollbar-frame', l.scrollbarFrameImg, 'scrollbar_frame (9-patch)', l.scrollbarFramePattern)}
          ${nineSlotHtml('scrollbar-thumb', l.scrollbarThumbImg, 'scrollbar_thumb (9-patch)', l.scrollbarThumbPattern)}
          <div class="field"><label>thumb_overlay</label><input type="checkbox" data-k="scrollbarThumbOverlay" data-type="checkbox" ${l.scrollbarThumbOverlay ? 'checked' : ''}></div>
          <div class="field"><label>Расположение</label>
            <select data-k="scrollbarSlice">
              <option value="west" ${l.scrollbarSlice==='west'?'selected':''}>west</option>
              <option value="center" ${l.scrollbarSlice==='center'?'selected':''}>center</option>
              <option value="east" ${l.scrollbarSlice==='east'?'selected':''}>east</option>
            </select>
          </div>
          <div class="row2">
            <div class="field"><label>left_pad</label><input type="number" data-k="scrollbarLeftPad" value="${l.scrollbarLeftPad}"></div>
            <div class="field"><label>right_pad</label><input type="number" data-k="scrollbarRightPad" value="${l.scrollbarRightPad}"></div>
          </div>
          <div class="row2" style="margin-top:6px;">
            <div class="field"><label>top_pad</label><input type="number" data-k="scrollbarTopPad" value="${l.scrollbarTopPad}"></div>
            <div class="field"><label>bottom_pad</label><input type="number" data-k="scrollbarBottomPad" value="${l.scrollbarBottomPad}"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  if (l.type === 'progress') {
    fields += `
      <div class="field-group">
        <h4>Прогресс-бар</h4>
        <div class="field"><label>id="__timeout__"</label><input type="checkbox" data-k="useTimeoutId" data-type="checkbox" ${l.useTimeoutId ? 'checked' : ''}></div>
        ${!l.useTimeoutId ? '<div class="hint-small">⚠ Без id="__timeout__" бар статичен и в GRUB почти не виден. Включите для обратного отсчёта (нужен set timeout в grub.cfg).</div>' : '<div class="hint-small">На холсте всегда показан статичный кадр (62%) — это макет. Реальный обратный отсчёт смотрите кнопкой «▶ Превью» вверху.</div>'}
        <div class="field"><label>Цвет заливки</label><input type="color" data-k="barColor" value="${l.barColor}"></div>
        <div class="field"><label>Цвет фона</label><input type="color" data-k="barBg" value="${l.barBg}"></div>
        <div class="field"><label>Показывать текст</label><input type="checkbox" data-k="showBarText" data-type="checkbox" ${l.showBarText ? 'checked' : ''}></div>
        ${l.showBarText ? `<div class="field" style="flex-direction:column;align-items:stretch;gap:4px;">
          <label>Текст (%d — секунды)</label>
          <input type="text" data-k="barText" value="${escapeHtml(l.barText)}" style="width:100%;">
        </div>
        <div class="field"><label>Цвет текста</label><input type="color" data-k="barTextColor" value="${l.barTextColor || '#ffffff'}"></div>
        <div class="field"><label>Шрифт текста</label>
          <select data-k="barFontName">
            ${['DejaVu Sans Mono', 'DejaVu Sans', 'Unifont', ...projectFonts.map(f=>f.name.replace(/\s+(Bold|Regular|Italic|BoldItalic)\s+\d+$/i,'')).filter((v,i,a)=>a.indexOf(v)===i)].filter((v,i,a)=>a.indexOf(v)===i).map(n => `<option value="${n}" ${ (l.barFontName||l.fontName||'DejaVu Sans Mono')===n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label></label><button data-action="upload-menu-font" style="width:100%;">+ Загрузить свой шрифт .pf2</button></div>
        <div class="field"><label>Размер шрифта</label><input type="number" data-k="barFontSize" value="${l.barFontSize || 16}" min="6"></div>
        ${l.barFontRef
          ? `<div class="hint-small">✓ Привязан к реальному файлу: <b>${escapeHtml(l.barFontRef)}</b>. Изменение размера сбросит привязку — .pf2 не масштабируется.</div>`
          : `<div class="hint-small">⚠ Реального .pf2 под эту комбинацию не загружено — приближение системным шрифтом браузера.</div>`}` : ''}
      </div>
      <div class="field-group">
        <h4>Styled boxes (9-patch)</h4>
        ${nineSlotHtml('bar-style', l.barStyleImg, 'bar_style — рамка бара')}
        <div class="field"><label>Толщина, px</label><input type="number" data-k="barStyleBorder" value="${l.barStyleBorder}"></div>
        ${nineSlotHtml('highlight-style', l.highlightStyleImg, 'highlight_style — заливка')}
        <div class="field"><label>Толщина, px</label><input type="number" data-k="highlightStyleBorder" value="${l.highlightStyleBorder}"></div>
        <div class="field"><label>highlight_overlay</label><input type="checkbox" data-k="highlightOverlay" data-type="checkbox" ${l.highlightOverlay ? 'checked' : ''}></div>
        <div class="hint-small">highlight_overlay=true — рамка накладывается поверх заливки, для скруглённых краёв.</div>
      </div>
    `;
  }

  if (l.type === 'circular') {
    fields += `
      <div class="field-group">
        <h4>Круговой прогресс</h4>
        <div class="field"><label>id="__timeout__"</label><input type="checkbox" data-k="useTimeoutId" data-type="checkbox" ${l.useTimeoutId ? 'checked' : ''}></div>
        ${!l.useTimeoutId ? '<div class="hint-small">⚠ Без id="__timeout__" круг статичен: при ticks_disappear в GRUB будет пустым. Включите для обратного отсчёта.</div>' : '<div class="hint-small">На холсте — статичный макет. Реальную анимацию отсчёта смотрите кнопкой «▶ Превью» вверху.</div>'}
        <div class="hint-small">⚠ В GRUB у circular_progress <b>нет текста и нет заливки цветом</b> — компонент существует только через картинки center_bitmap/tick_bitmap ниже. Без них в реальном GRUB он будет полностью невидим.</div>
        <div class="field"><label>num_ticks</label><input type="number" data-k="numTicks" value="${l.numTicks}"></div>
        <div class="field"><label>start_angle (GRUB: 256 = круг, -64 = верх)</label><input type="number" data-k="startAngle" value="${l.startAngle}"></div>
        <div class="field"><label>ticks_disappear</label><input type="checkbox" data-k="ticksDisappear" data-type="checkbox" ${l.ticksDisappear ? 'checked' : ''}></div>
      </div>
      <div class="field-group">
        <h4>Картинки (bitmaps) — обязательны для видимости</h4>
        ${singleSlotHtml('center-bitmap', l.centerBitmap, 'center_bitmap — картинка в центре', 'Одна PNG-картинка (не 9-patch), фиксированного размера, по центру круга.')}
        ${singleSlotHtml('tick-bitmap', l.tickBitmap, 'tick_bitmap — картинка одной метки', 'Одна PNG-картинка одной "метки" — GRUB сам расставляет её по кругу numTicks раз.')}
        <div class="hint-small">Квадратные изображения (width = height) дают симметричный круг. Картинки не масштабируются GRUB — делайте нужного размера сразу.</div>
      </div>
    `;
  }

  if (l.type === 'label') {
    fields += `
      <div class="field-group">
        <h4>Текст</h4>
        <div class="hint-small">Шрифт пишется в theme.txt как <b>имя + px</b>, но GRUB видит только <b>.pf2</b>. Без font/*.pf2 будет мелкий встроенный шрифт — загрузите .pf2 в дереве проекта.</div>
        <div class="field"><label>Содержимое</label><input type="text" data-k="text" value="${escapeHtml(l.text)}"></div>
        ${/@(TIMEOUT|KEYMAP)_/.test(l.text || '') && !l.useTimeoutId ? '<div class="hint-small">⚠ В тексте есть @VAR@, но id="__timeout__" выключен — в GRUB переменная НЕ подставится и будет видна сырым текстом. Включите галку ниже.</div>' : ''}
        <div class="field" style="margin-bottom:10px;">
          <label>Вставить переменную</label>
          <select id="label-var-insert" style="width:170px;">
            <option value="">— выбрать —</option>
            <option value="@TIMEOUT_NOTIFICATION_SHORT@">@TIMEOUT_NOTIFICATION_SHORT@</option>
            <option value="@TIMEOUT_NOTIFICATION_MIDDLE@">@TIMEOUT_NOTIFICATION_MIDDLE@</option>
            <option value="@TIMEOUT_NOTIFICATION_LONG@">@TIMEOUT_NOTIFICATION_LONG@</option>
            <option value="@KEYMAP_SHORT@">@KEYMAP_SHORT@</option>
            <option value="@KEYMAP_MIDDLE@">@KEYMAP_MIDDLE@</option>
            <option value="@KEYMAP_LONG@">@KEYMAP_LONG@</option>
          </select>
        </div>
        <div class="field"><label>id="__timeout__"</label><input type="checkbox" data-k="useTimeoutId" data-type="checkbox" ${l.useTimeoutId ? 'checked' : ''}></div>
        ${/@(TIMEOUT|KEYMAP)_/.test(l.text || '') && !l.useTimeoutId ? '<div class="hint-small">⚠ @VAR@ без id="__timeout__" покажется сырым текстом.</div>' : ''}
        <div class="field"><label>Шрифт (семейство)</label>
          <select data-k="fontName">
            ${['DejaVu Sans Mono', 'DejaVu Sans', 'Unifont', ...projectFonts.map(f=>f.name.replace(/\s+(Bold|Regular|Italic|BoldItalic)\s+\d+$/i,'')).filter((v,i,a)=>a.indexOf(v)===i)].filter((v,i,a)=>a.indexOf(v)===i).map(n => `<option value="${n}" ${ (l.fontName||'DejaVu Sans Mono')===n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label></label><button data-action="upload-menu-font" style="width:100%;">+ Загрузить свой шрифт .pf2</button></div>
        <div class="field"><label>Размер шрифта</label><input type="number" data-k="fontSize" value="${l.fontSize}"></div>
        ${l.fontRef
          ? `<div class="hint-small">✓ Привязан к реальному файлу: <b>${escapeHtml(l.fontRef)}</b></div>`
          : `<div class="hint-small">⚠ Реального .pf2 не загружено — в GRUB будет встроенный шрифт.</div>`}
        <div class="field"><label>Жирный</label><input type="checkbox" data-k="fontBold" data-type="checkbox" ${l.fontBold ? 'checked' : ''}></div>
        <div class="field"><label>Цвет</label><input type="color" data-k="color" value="${l.color}"></div>
        <div class="field"><label>Выравнивание</label>
          <select data-k="align">
            <option value="left" ${l.align==='left'?'selected':''}>left</option>
            <option value="center" ${l.align==='center'?'selected':''}>center</option>
            <option value="right" ${l.align==='right'?'selected':''}>right</option>
          </select>
        </div>
      </div>
    `;
  }

  if (l.type === 'box') {
    fields += `
      <div class="field-group">
        <h4>Прямоугольник</h4>
        <div class="field"><label>Заливка</label><input type="color" data-k="boxColorPicker" value="${rgbaToHex(l.boxColor)}"></div>
        <div class="field"><label>Цвет рамки</label><input type="color" data-k="boxBorderPicker" value="${rgbaToHex(l.boxBorder)}"></div>
        <div class="hint-small">Декоративный элемент — просто прямоугольная область без содержимого.</div>
      </div>
    `;
  }

  if (l.type === 'image') {
    fields += `
      <div class="field-group">
        <h4>Картинка</h4>
        ${singleSlotHtml('image-file-slot', l.imgUrl, l.imgUrl ? 'Заменить картинку' : 'Выбрать картинку', 'Обычный PNG-файл (не 9-patch) — картинка вставляется как есть, растягивается по размеру рамки слоя.')}
        <div class="hint-small">Произвольная декоративная картинка (лого, персонаж, элемент оформления).</div>
      </div>
    `;
  }

  fields += `
    <div class="field-group">
      <button id="btn-del-layer" style="width:100%;color:var(--danger);border-color:var(--danger);">Удалить слой</button>
    </div>
  `;

  el.innerHTML = fields;

  // Фокус-фикс: el.innerHTML пересоздаёт DOM — renderAll() убьёт фокус, поэтому guard в renderAll + тут
  let textDebounce = null;
// pf2 — растровый (bitmap) шрифт ФИКСИРОВАННОГО кегля: один .pf2-файл содержит глифы
// ровно одного размера/начертания, GRUB его не масштабирует (в отличие от TTF/OTF).
// Если слой уже привязан к конкретному загруженному файлу (fontRef/itemFontRef/...),
// а пользователь потом меняет размер/семейство/жирность в инспекторе "на глаз" — эта
// привязка становится ложью: холст покажет один размер, а реально в GRUB отрисуется
// либо старый зашитый в файл размер, либо (если строка перестала совпадать вообще
// ни с одним loadfont) GRUB молча откатится на встроенный дефолт — то, что видно
// на скриншоте QEMU: заказанный "Comic Sans MS" не нашёлся, и GRUB тихо взял свой шрифт.
// Поэтому при таком изменении сбрасываем привязку — честное предупреждение
// "шрифт не найден, нужен .pf2 такого-то кегля" лучше, чем тихое рассогласование.
function invalidateFontRefOnEdit(l, k) {
  if (l.type === 'menu' && (k === 'fontSize' || k === 'fontName')) {
    l.itemFontRef = null;
  } else if (l.type === 'menu' && k === 'selectedFontSize') {
    l.selectedItemFontRef = null;
  } else if (l.type === 'label' && (k === 'fontSize' || k === 'fontName' || k === 'fontBold')) {
    l.fontRef = null;
  } else if (l.type === 'progress' && (k === 'barFontSize' || k === 'barFontName')) {
    l.barFontRef = null;
  }
}
  el.querySelectorAll('input[data-k], select[data-k]').forEach(inp => {
    const k = inp.getAttribute('data-k');
    const handler = () => {
      if (inp.type === 'checkbox') {
        l[k] = inp.checked;
        invalidateFontRefOnEdit(l, k);
        const keepK = k;
        renderInspector();
        const n = document.querySelector(`#inspector-body input[data-k=\"${keepK}\"]`);
        if (n) n.focus();
        renderAll();
        return;
      } else if (k === 'boxColorPicker') {
        l.boxColor = inp.value;
      } else if (k === 'boxBorderPicker') {
        l.boxBorder = inp.value;
      } else if (k === 'selectedFontSize') {
        const n = Number(inp.value);
        l.selectedFontSize = n > 0 ? n : null;
      } else {
        l[k] = inp.type === 'number' ? Number(inp.value) : inp.value;
      }
      invalidateFontRefOnEdit(l, k);
      if ((k === 'w' || k === 'h') && l.type === 'image') l.imgAutoSize = false;
      l.name = defaultName(l);
      if (inp.type === 'number') {
        clearTimeout(textDebounce);
        textDebounce = setTimeout(() => { drawEditor(); renderLayerList(); }, 150);
        drawEditor();
        renderLayerList();
      } else {
        // text / color / select — без renderInspector/renderAll, иначе фокус слетает
        drawEditor();
        renderLayerList();
      }
    };
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
  });
  // При потере фокуса (blur) — финальный коммит с полным рендером
  el.querySelectorAll('input[data-k][type=\"text\"], input[data-k][type=\"color\"], select[data-k]').forEach(inp => {
    inp.addEventListener('blur', () => {
      renderAll();
      // после blur также нужно вызвать renderInspector на следующем тике, т.к. guard в renderAll блокировал его
      setTimeout(() => renderInspector(), 0);
    });
  });


  // Кнопка "+ Загрузить свой шрифт .pf2" в инспекторе меню — читает реальное имя из .pf2
  // (или честно угадывает по имени файла, если бинарник нечитаем) и запоминает РЕАЛЬНЫЙ
  // путь файла — при экспорте используется именно он, без придуманного переименования.
  const fontBtn = el.querySelector('[data-action="upload-menu-font"]');
  if (fontBtn) {
    fontBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.pf2';
      inp.onchange = async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        const entry = await addProjectFont(f);
        // ВАЖНО: эта кнопка используется в трёх разных местах инспектора (шрифт пункта
        // меню, шрифт лейбла, шрифт текста прогресс-бара) — раньше здесь БЕЗУСЛОВНО
        // писалось в l.itemFontRef, которое реально используется только слоем 'menu'.
        // Для label/progress это поле никто не читает: экспорт брал l.fontRef/l.barFontRef,
        // те оставались пустыми, и в theme.txt уходило синтезированное "Имя Bold/Regular N",
        // которое почти никогда не совпадает 1-в-1 с тем, что реально зашито в .pf2 —
        // отсюда ложное "шрифт не найден" даже после успешной загрузки файла.
        const parsed = parseFontString(entry.name);
        if (l.type === 'label') {
          l.fontRef = entry.name;
          l.fontName = parsed.name;
          l.fontSize = parsed.size;
          l.fontBold = parsed.bold;
        } else if (l.type === 'progress') {
          l.barFontRef = entry.name;
          l.barFontName = parsed.name;
          l.barFontSize = parsed.size;
        } else {
          // menu (шрифт обычных пунктов, item_font)
          l.itemFontRef = entry.name;
          l.fontName = parsed.name;
          l.fontSize = parsed.size;
        }
        l.name = defaultName(l);
        renderAll();
        renderInspector();
      };
      inp.click();
    });
  }

  // Универсальное подключение всех 9-patch / картиночных слотов вида
  // role="xxx-slot" + role="xxx-file"  ->  ключ модели в camelCase (xxxKEY передаётся картой ниже)
  const slotKeyMap = {
    'menu-border': 'menuBorderImg',
    'menu-normal-bg': 'menuNormalBg',
    'menu-selected-bg': 'menuSelectedBg',
    'scrollbar-frame': 'scrollbarFrameImg',
    'scrollbar-thumb': 'scrollbarThumbImg',
    'bar-style': 'barStyleImg',
    'highlight-style': 'highlightStyleImg',
    'center-bitmap': 'centerBitmap',
    'tick-bitmap': 'tickBitmap',
    'image-file-slot': 'imgUrl',
  };
  // Кнопка "✕ убрать ссылку" рядом с 9-slice слотами: сбрасывает "честно сохранённый"
  // путь из импорта (menuBorderPattern/menuNormalPattern/menuSelectedPattern/
  // scrollbarFramePattern/scrollbarThumbPattern), для которого нет ни одного реально
  // загруженного файла — иначе эта ссылка молча уходила бы в каждый экспорт и каждый
  // раз ловилась бы санитайзером как "файл отсутствует", а убрать её было нечем.
  const patternKeyMap = {
    'menu-border': 'menuBorderPattern',
    'menu-normal-bg': 'menuNormalPattern',
    'menu-selected-bg': 'menuSelectedPattern',
    'scrollbar-frame': 'scrollbarFramePattern',
    'scrollbar-thumb': 'scrollbarThumbPattern',
  };
  Object.entries(patternKeyMap).forEach(([role, patternKey]) => {
    const btn = el.querySelector(`[data-role="${role}-clear-pattern"]`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      l[patternKey] = null;
      renderInspector();
      renderAll();
    });
  });
  Object.entries(slotKeyMap).forEach(([role, targetKey]) => {
    // 9-slice виджеты (рамка меню, подложки пунктов, скроллбар, terminal-box) —
    // теперь по 9 отдельных слотов nw/n/ne/w/c/e/sw/s/se вместо одного.
    let boundAny = false;
    NINE_SLOTS.forEach(([suf]) => {
      const box = el.querySelector(`[data-role="${role}-${suf}-slot"]`);
      const file = el.querySelector(`[data-role="${role}-${suf}-file"]`);
      if (!box || !file) return;
      boundAny = true;
      box.addEventListener('click', () => file.click());
      file.addEventListener('change', (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        const thumbEl = box.querySelector('.thumb');
        if (thumbEl) thumbEl.innerHTML = '<span style="opacity:.7;">⏳</span>';
        handlePickedImageFile(f, (url) => {
          const cur = (l[targetKey] && typeof l[targetKey] === 'object') ? { ...l[targetKey] } : {};
          cur.__slices = true;
          cur[suf] = url;
          l[targetKey] = cur;
          l[targetKey + 'Pattern'] = null; // сброс "честного" пути импорта — теперь это свежая нарезка редактора
          cacheImage(url, () => { renderInspector(); renderAll(); });
          renderInspector();
          renderAll();
        }, () => renderInspector());
      });
    });
    if (boundAny) return;
    // одиночные слоты без 9-slice (обычная картинка-слой, center/tick-bitmap и т.п.)
    const box = el.querySelector(`[data-role="${role}-slot"], [data-role="${role}"]`);
    const file = el.querySelector(`[data-role="${role}-file"]`);
    if (!box || !file) return;
    box.addEventListener('click', () => file.click());
    file.addEventListener('change', (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      const thumbEl = box.querySelector('.thumb');
      if (thumbEl) thumbEl.innerHTML = '<span style="opacity:.7;">⏳ конвертация…</span>';
      handlePickedImageFile(f, (url) => {
        l[targetKey] = url;
        cacheImage(url, () => { renderInspector(); renderAll(); });
        renderInspector();
        renderAll();
      }, () => renderInspector());
    });
  });

  // вставка спец. переменных в текст label
  const varSelect = document.getElementById('label-var-insert');
  if (varSelect) {
    varSelect.addEventListener('change', () => {
      if (!varSelect.value) return;
      l.text = (l.text || '') + varSelect.value;
      l.name = defaultName(l);
      renderAll();
      renderInspector();
    });
  }

  document.getElementById('btn-del-layer').addEventListener('click', () => removeLayer(l.id));
}

function rgbaToHex(v) {
  // на входе может быть уже hex или rgba(...) — для простоты приводим только не-hex к approx
  if (!v) return '#ffffff';
  if (v.startsWith('#')) return v.length === 9 ? v.slice(0, 7) : v; // срезаем альфу если есть #rrggbbaa
  return '#ffffff';
}

/* ============================================================
   ЭКСПОРТ theme.txt
   ============================================================ */

// координата в текущем выбранном формате (проценты или пиксели)
// GRUB 2.12 не парсит дробные проценты — только целые (error: unrecognized number)
function coord(v, total) {
  if (theme.coordMode === 'px') return String(Math.round(v));
  return Math.round((v / total) * 100) + '%';
}
function pct(v, total) { return coord(v, total); }

function buildThemeTxt() {
  const lines = [];
  lines.push(`# Сгенерировано GRUB Theme Editor`);
  // desktop-image пишем только если фон реально загружен и валиден (bgImage.complete + naturalWidth>0).
  // Если blob: URL протух (например, после загрузки старого JSON-проекта в новой вкладке) —
  // bgImage останется null/битым, и GRUB не получит ссылку на несуществующий файл — будет просто desktop-color.
  const bgUsable = !!(bgImageUrl && bgImage && bgImage.complete && bgImage.naturalWidth > 0);
  if (bgUsable) {
    lines.push(`desktop-image: "background.png"`);
    lines.push(`desktop-image-scale-method: "${theme.bgScaleMethod}"`);
    lines.push(`desktop-image-h-align: "${theme.bgHAlign}"`);
    lines.push(`desktop-image-v-align: "${theme.bgVAlign}"`);
  }
  lines.push(`desktop-color: "${bgColor}"`);
  if (theme.titleVisible && theme.titleText) {
    lines.push(`title-text: "${theme.titleText}"`);
    lines.push(`title-font: "${theme.titleFont}"`);
    lines.push(`title-color: "${theme.titleColor}"`);
  } else {
    lines.push(`title-text: ""`);
  }
  if (theme.terminalVisible) {
    // одиночная картинка (string) → пишем plain-путь без wildcard, 9-slice объект — с wildcard
    if (theme.terminalBoxImg) {
      if (typeof theme.terminalBoxImg === 'object') {
        // нарезка реально экспортируется под assets/terminal_box/terminal_*.png —
        // исходный паттерн импорта (terminal_box_*.png) в новом архиве не существует
        lines.push(`terminal-box: "assets/terminal_box/terminal_*.png"`);
      } else {
        lines.push(`terminal-box: "terminal_box.png"`);
      }
    } else if (theme.terminalBoxPattern) {
      // файлов-кусков нет (или тема пришла без них), но паттерн был — сохраняем строку, чтобы GRUB не потерял terminal-box
      lines.push(`terminal-box: "${theme.terminalBoxPattern}"`);
    }
    if (theme.terminalFont) lines.push(`terminal-font: "${theme.terminalFont}"`);
    // ВАЖНО: все глобальные свойства theme.txt — СТРОКИ В КАВЫЧКАХ (так требует парсер
    // тем GRUB: любое незакавыченное значение вне блоков → "property value invalid" с
    // отказом загрузки всей темы). См. официальные темы и Theme file format, GNU GRUB Manual.
    lines.push(`terminal-border: "${theme.terminalBorder}"`);
    lines.push(`terminal-left: "${theme.terminalLeft}%"`);
    lines.push(`terminal-top: "${theme.terminalTop}%"`);
    lines.push(`terminal-width: "${theme.terminalWidth}%"`);
    lines.push(`terminal-height: "${theme.terminalHeight}%"`);
  }
  lines.push('');

  layers.forEach(l => {
    if (!l.visible) return;
    // ВАЖНО: внутри блоков (+ boot_menu { ... }) значения свойств пишутся БЕЗ кавычек
    // (числа, проценты, true/false — так в официальных темах и в docs/example_theme.txt).
    // Кавычки обязательны ТОЛЬКО для строк (шрифты, цвета, пути) и для ГЛОБАЛЬНЫХ свойств.
    if (l.type === 'menu') {
      lines.push(`+ boot_menu {`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      lines.push(`  width = ${coord(l.w, STAGE_W)}`);
      lines.push(`  height = ${coord(l.h, STAGE_H)}`);
      lines.push(`  item_height = ${l.itemHeight}`);
      lines.push(`  item_padding = ${l.itemPadding}`);
      lines.push(`  item_spacing = ${l.itemSpacing}`);
      lines.push(`  item_icon_space = ${l.itemIconSpace}`);
      // item_font: если пришло из импорта — пишем ТОЧНУЮ исходную строку (itemFontRef),
      // так она гарантированно совпадает с реальным .pf2-файлом, который лежит в архиве.
      // Для слоя, созданного в редакторе с нуля (нет itemFontRef), синтезируем как раньше.
      lines.push(`  item_font = "${l.itemFontRef || `${l.fontName || 'DejaVu Sans Mono'} Regular ${l.fontSize}`}"`);
      // selected_item_font: пишем ТОЛЬКО если в оригинале он реально был задан отдельно
      // (hasSeparateSelectedFont) — иначе GRUB и так возьмёт item_font для обоих состояний,
      // различая их по цвету (item_color/selected_item_color). Раньше редактор ВСЕГДА
      // дописывал несуществующий "... Bold N" вариант, которого могло не быть в архиве вообще.
      if (l.hasSeparateSelectedFont) {
        lines.push(`  selected_item_font = "${l.selectedItemFontRef || `${l.fontName || 'DejaVu Sans Mono'} Bold ${l.selectedFontSize || l.fontSize}`}"`);
      } else if (l.selectedFontSize) {
        // пользователь в редакторе явно задал отдельный размер для выбранного пункта —
        // тогда отдельный selected_item_font всё же нужен, синтезируем его
        lines.push(`  selected_item_font = "${l.fontName || 'DejaVu Sans Mono'} Bold ${l.selectedFontSize}"`);
      }
      lines.push(`  item_color = "${l.color}"`);
      lines.push(`  selected_item_color = "${l.selectedColor}"`);
      lines.push(`  icon_width = ${l.iconWidth || 32}`);
      lines.push(`  icon_height = ${l.iconHeight || 32}`);
      if (l.maxItemsShown > 0) lines.push(`  max_items_shown = ${l.maxItemsShown}`);
      // menu_*_pixmap_style: одиночная картинка (string) пишется БЕЗ wildcard
      // (GRUB видит только X.png, а не X_nw.png...), 9-slice объект — с wildcard X_*.png.
      // ВАЖНО: если 9-slice объект реально загружен (есть файлы), они экспортируются под
      // assets/menu-<id>/..., поэтому в theme.txt должен попасть ИМЕННО этот путь.
      // Исходный паттерн из импорта (l.menuBorderPattern) ссылается на файлы, которых
      // в новом экспорте нет, — санитайзер будет честно вырезать такую строку.
      const menuPix = l.menuBorderImg
        ? (typeof l.menuBorderImg === 'object' ? `assets/menu-${l.id}/menu_*.png` : `assets/menu-${l.id}/menu.png`)
        : l.menuBorderPattern;
      if (menuPix) lines.push(`  menu_pixmap_style = "${menuPix}"`);
      const itemPix = l.menuNormalBg
        ? (typeof l.menuNormalBg === 'object' ? `assets/menu-${l.id}/item_*.png` : `assets/menu-${l.id}/item.png`)
        : l.menuNormalPattern;
      if (itemPix) lines.push(`  item_pixmap_style = "${itemPix}"`);
      const selPix = l.menuSelectedBg
        ? (typeof l.menuSelectedBg === 'object' ? `assets/menu-${l.id}/select_*.png` : `assets/menu-${l.id}/select.png`)
        : l.menuSelectedPattern;
      if (selPix) lines.push(`  selected_item_pixmap_style = "${selPix}"`);
      lines.push(`  scrollbar = ${l.scrollbarEnabled ? 'true' : 'false'}`);
      if (l.scrollbarEnabled) {
        // scrollbar_frame/thumb: одиночная картинка → plain-путь без wildcard, 9-slice — с wildcard
        if (l.scrollbarFrameImg) {
          const sf = typeof l.scrollbarFrameImg === 'object' ? `assets/menu-${l.id}/scroll_frame_*.png` : `assets/menu-${l.id}/scroll_frame.png`;
          lines.push(`  scrollbar_frame = "${sf}"`);
        }
        if (l.scrollbarThumbImg) {
          const st = typeof l.scrollbarThumbImg === 'object' ? `assets/menu-${l.id}/scroll_thumb_*.png` : `assets/menu-${l.id}/scroll_thumb.png`;
          lines.push(`  scrollbar_thumb = "${st}"`);
        }
        lines.push(`  scrollbar_thumb_overlay = ${l.scrollbarThumbOverlay ? 'true' : 'false'}`);
        lines.push(`  scrollbar_slice = ${l.scrollbarSlice}`);
        lines.push(`  scrollbar_left_pad = ${l.scrollbarLeftPad}`);
        lines.push(`  scrollbar_right_pad = ${l.scrollbarRightPad}`);
        lines.push(`  scrollbar_top_pad = ${l.scrollbarTopPad}`);
        lines.push(`  scrollbar_bottom_pad = ${l.scrollbarBottomPad}`);
      }
      lines.push(`  visible = ${l.visible ? 'true' : 'false'}`);
      lines.push(`}`);
    }
    if (l.type === 'progress') {
      lines.push(`+ progress_bar {`);
      if (l.useTimeoutId) lines.push(`  id = "__timeout__"`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      lines.push(`  width = ${coord(l.w, STAGE_W)}`);
      lines.push(`  height = ${l.h}`);
      lines.push(`  fg_color = "${l.barColor}"`);
      lines.push(`  bg_color = "${l.barBg}"`);
      // border_color: раньше писался ВСЕГДА как фиксированный "#ffffff", даже если в оригинале
      // его не было вовсе (как в astronaut-теме) — теперь пишем только если он реально задан.
      if (l.hasBorderColor && l.barBorderColor) lines.push(`  border_color = "${l.barBorderColor}"`);
      // bar_style/highlight_style: одиночная картинка → plain-путь без wildcard, 9-slice — с wildcard
      if (l.barStyleImg) {
        const bp = typeof l.barStyleImg === 'object' ? `assets/progress-${l.id}/frame_*.png` : `assets/progress-${l.id}/frame.png`;
        lines.push(`  bar_style = "${bp}"`);
      }
      if (l.highlightStyleImg) {
        const hp = typeof l.highlightStyleImg === 'object' ? `assets/progress-${l.id}/highlight_*.png` : `assets/progress-${l.id}/highlight.png`;
        lines.push(`  highlight_style = "${hp}"`);
        lines.push(`  highlight_overlay = ${l.highlightOverlay ? 'true' : 'false'}`);
      }
      if (l.showBarText) {
        lines.push(`  show_text = true`);
        lines.push(`  text = "${l.barText}"`);
        lines.push(`  text_color = "${l.barTextColor || 'white'}"`);
        lines.push(`  font = "${l.barFontRef || `${l.barFontName || l.fontName || 'DejaVu Sans Mono'} Regular ${l.barFontSize || 16}`}"`);
      }
      lines.push(`}`);
    }
    if (l.type === 'circular') {
      lines.push(`+ circular_progress {`);
      if (l.useTimeoutId) lines.push(`  id = "__timeout__"`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      lines.push(`  width = ${coord(l.w, STAGE_W)}`);
      lines.push(`  height = ${coord(l.h, STAGE_H)}`);
      if (l.centerBitmap) lines.push(`  center_bitmap = "assets/circular-${l.id}/center.png"`);
      if (l.tickBitmap) lines.push(`  tick_bitmap = "assets/circular-${l.id}/tick.png"`);
      lines.push(`  num_ticks = ${l.numTicks}`);
      lines.push(`  ticks_disappear = ${l.ticksDisappear ? 'true' : 'false'}`);
      lines.push(`  start_angle = ${l.startAngle}`);
      lines.push(`}`);
    }
    if (l.type === 'label') {
      lines.push(`+ label {`);
      if (l.useTimeoutId) lines.push(`  id = "__timeout__"`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      lines.push(`  width = ${coord(l.w, STAGE_W)}`);
      lines.push(`  text = "${l.text}"`);
      lines.push(`  font = "${l.fontRef || `${l.fontName || 'DejaVu Sans Mono'} ${l.fontBold ? 'Bold' : 'Regular'} ${l.fontSize}`}"`);
      lines.push(`  color = "${l.color}"`);
      lines.push(`  align = "${l.align || 'left'}"`);
      lines.push(`}`);
    }
    if (l.type === 'box') {
      // Прямоугольник-декор: GRUB не имеет примитива "box", эмулируется через
      // + image с PNG-заливкой. PNG генерируется при экспорте (цвет+рамка),
      // либо используется загруженная текстура — поэтому file ВСЕГДА существует.
      lines.push(`+ image {`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      lines.push(`  width = ${coord(l.w, STAGE_W)}`);
      lines.push(`  height = ${coord(l.h, STAGE_H)}`);
      lines.push(`  file = "assets/box-${l.id}.png"`);
      lines.push(`}`);
    }
    if (l.type === 'image') {
      // + image БЕЗ выбранного файла пропускаем: иначе theme.txt сошлётся на
      // несуществующий assets/image-N.png и GRUB упадёт с "file not found".
      if (!l.imgUrl) {
        lines.push(`# Картинка "${l.name}" пропущена при экспорте: файл не выбран.`);
        lines.push('');
        return;
      }
      lines.push(`+ image {`);
      lines.push(`  left = ${coord(l.x, STAGE_W)}`);
      lines.push(`  top = ${coord(l.y, STAGE_H)}`);
      if (!l.imgAutoSize) {
        lines.push(`  width = ${coord(l.w, STAGE_W)}`);
        lines.push(`  height = ${coord(l.h, STAGE_H)}`);
      }
      lines.push(`  file = "${l.imgPattern || `assets/image-${l.id}.png`}"`);
      lines.push(`}`);
    }
    lines.push('');
  });

  if (osEntries.length) {
    lines.push('# ---------------------------------------------------------');
    lines.push('# Пункты меню и их иконки (обычная / выбранная).');
    lines.push('# Привязка идёт через --class <имя> у каждого menuentry в grub.cfg.');
    lines.push('# ---------------------------------------------------------');
    osEntries.forEach((e, i) => {
      const cls = e.osClass || ('os' + (i + 1));
      lines.push(`# ${i + 1}. "${e.name}"  →  menuentry ... --class ${cls} { ... }`);
      lines.push(`#    icon: ${(e.normalImg || defaultIconClassFor(e)) ? 'icons/' + cls + '.png' : '(не задано)'}`);
    });
    lines.push('');
  }

  lines.push('# ---------------------------------------------------------');
  lines.push('# Примечания по 9-patch: файлы вида name_*.png нужно нарезать из');
  lines.push('# исходной картинки на 9 частей (nw,n,ne,w,c,e,sw,s,se) по границе');
  lines.push('# border, указанной для каждого слота в редакторе — предпросмотр');
  lines.push('# в редакторе уже показывает именно такое 9-slice масштабирование.');
  lines.push('# Формат координат допускает и смешанный вид: left = 25%+10');
  lines.push('# ---------------------------------------------------------');

  return lines.join('\n');
}

document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('export-text').textContent = buildThemeTxt();
  document.getElementById('modal-bg').classList.add('show');
});
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal-bg').classList.remove('show'));
document.getElementById('btn-copy').addEventListener('click', () => navigator.clipboard.writeText(buildThemeTxt()));
document.getElementById('btn-download').addEventListener('click', () => {
  const blob = new Blob([buildThemeTxt()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'theme.txt';
  a.click();
});

/* ============================================================
   CANVAS PROPERTIES (модалка настроек холста)
   ============================================================ */

function populatePresetSelect() {
  const sel = document.getElementById('cp-preset');
  sel.innerHTML = RESOLUTION_PRESETS.map(p => `<option value="${p.w}x${p.h}">${p.label}</option>`).join('')
    + `<option value="custom">Custom…</option>`;
}
populatePresetSelect();

function openCanvasProps() {
  document.getElementById('cp-width').value = STAGE_W;
  document.getElementById('cp-height').value = STAGE_H;
  document.getElementById('cp-bgcolor').value = bgColor;
  const matched = RESOLUTION_PRESETS.find(p => p.w === STAGE_W && p.h === STAGE_H);
  document.getElementById('cp-preset').value = matched ? `${STAGE_W}x${STAGE_H}` : 'custom';

  document.getElementById('cp-bg-scale').value = theme.bgScaleMethod;
  document.getElementById('cp-bg-halign').value = theme.bgHAlign;
  document.getElementById('cp-bg-valign').value = theme.bgVAlign;
  document.getElementById('cp-title-on').checked = theme.titleVisible;
  document.getElementById('cp-title-text').value = theme.titleText;
  document.getElementById('cp-title-color').value = theme.titleColor;
  document.getElementById('cp-term-on').checked = theme.terminalVisible;
  document.getElementById('cp-term-browse').textContent = theme.terminalBoxImg ? 'Файл выбран ✓' : 'Обзор…';
  document.getElementById('cp-term-border').value = theme.terminalBorder;
  document.getElementById('cp-term-left').value = theme.terminalLeft;
  document.getElementById('cp-term-top').value = theme.terminalTop;
  document.getElementById('cp-term-width').value = theme.terminalWidth;
  document.getElementById('cp-term-height').value = theme.terminalHeight;
  document.getElementById('cp-coord-mode').value = theme.coordMode;

  document.getElementById('cp-modal-bg').classList.add('show');
}

let pendingTermFile = null;
document.getElementById('cp-term-browse').addEventListener('click', () => document.getElementById('cp-term-file').click());
document.getElementById('cp-term-file').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const btn = document.getElementById('cp-term-browse');
  btn.textContent = 'Конвертация…';
  handlePickedImageFile(f, (url) => {
    pendingTermFile = url;
    btn.textContent = 'Файл выбран ✓';
  });
});
document.getElementById('cp-term-remove').addEventListener('click', () => {
  pendingTermFile = 'REMOVE';
  document.getElementById('cp-term-browse').textContent = 'Обзор…';
});
document.getElementById('btn-canvas-props').addEventListener('click', openCanvasProps);
document.getElementById('cp-close').addEventListener('click', () => document.getElementById('cp-modal-bg').classList.remove('show'));
document.getElementById('cp-cancel').addEventListener('click', () => document.getElementById('cp-modal-bg').classList.remove('show'));
document.getElementById('cp-modal-bg').addEventListener('click', (e) => { if(e.target.id==='cp-modal-bg') e.currentTarget.classList.remove('show'); });

document.getElementById('cp-preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  const [w, h] = e.target.value.split('x').map(Number);
  document.getElementById('cp-width').value = w;
  document.getElementById('cp-height').value = h;
});
['cp-width', 'cp-height'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById('cp-preset').value = 'custom';
  });
});

document.getElementById('cp-bg-browse').addEventListener('click', () => document.getElementById('cp-bg-file').click());
let pendingBgFile = null;
document.getElementById('cp-bg-file').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const btn = document.getElementById('cp-bg-browse');
  btn.textContent = 'Конвертация…';
  handlePickedImageFile(f, (url) => {
    pendingBgFile = url;
    btn.textContent = 'Файл выбран ✓';
  });
});
document.getElementById('cp-bg-remove').addEventListener('click', () => {
  pendingBgFile = 'REMOVE';
  document.getElementById('cp-bg-browse').textContent = 'Обзор…';
});

document.getElementById('cp-ok').addEventListener('click', () => {
  STAGE_W = Number(document.getElementById('cp-width').value) || STAGE_W;
  STAGE_H = Number(document.getElementById('cp-height').value) || STAGE_H;
  bgColor = document.getElementById('cp-bgcolor').value;
  if (pendingBgFile === 'REMOVE') {
    bgImage = null; bgImageUrl = null;
  } else if (pendingBgFile) {
    bgImageUrl = pendingBgFile;
    const img = new Image();
    img.onload = () => { bgImage = img; renderAll(); };
    img.src = pendingBgFile;
  }
  pendingBgFile = null;
  document.getElementById('cp-bg-browse').textContent = 'Обзор…';

  theme.bgScaleMethod = document.getElementById('cp-bg-scale').value;
  theme.bgHAlign = document.getElementById('cp-bg-halign').value;
  theme.bgVAlign = document.getElementById('cp-bg-valign').value;
  theme.titleVisible = document.getElementById('cp-title-on').checked;
  theme.titleText = document.getElementById('cp-title-text').value;
  theme.titleColor = document.getElementById('cp-title-color').value;
  theme.terminalVisible = document.getElementById('cp-term-on').checked;
  theme.terminalBorder = Number(document.getElementById('cp-term-border').value) || 12;
  theme.terminalLeft = Number(document.getElementById('cp-term-left').value) || 0;
  theme.terminalTop = Number(document.getElementById('cp-term-top').value) || 0;
  theme.terminalWidth = Number(document.getElementById('cp-term-width').value) || 80;
  theme.terminalHeight = Number(document.getElementById('cp-term-height').value) || 80;
  theme.coordMode = document.getElementById('cp-coord-mode').value;
  if (pendingTermFile === 'REMOVE') {
    theme.terminalBoxImg = null;
  } else if (pendingTermFile) {
    theme.terminalBoxImg = pendingTermFile;
    cacheImage(pendingTermFile);
  }
  pendingTermFile = null;

  resizeStage();
  renderAll();
  document.getElementById('cp-modal-bg').classList.remove('show');
});

/* ============================================================
   ZOOM
   ============================================================ */

function setZoom(z) {
  zoom = Math.max(0.1, Math.min(1.5, z));
  resizeStage();
  renderAll();
}
// Ctrl+колесо над холстом — зум холста, без зума страницы
(function(){
  const wrap = document.getElementById('canvas-wrap');
  if(!wrap) return;
  wrap.addEventListener('wheel', (e)=>{
    if(!e.ctrlKey) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    setZoom(zoom + dir * 0.05);
  }, {passive:false});
  // также перехватываем Ctrl+/- на странице когда фокус в редакторе
  window.addEventListener('keydown', (e)=>{
    if(!(e.ctrlKey||e.metaKey)) return;
    if(e.key==='='||e.key==='+'){ e.preventDefault(); setZoom(zoom+0.1); }
    if(e.key==='-'||e.key==='_'){ e.preventDefault(); setZoom(zoom-0.1); }
    if(e.key==='0'){ e.preventDefault(); setZoom(0.5); }
  });
  // блокируем браузерный зум через Ctrl+колесо вне холста тоже, если курсор внутри app
  document.getElementById('app')?.addEventListener('wheel', (e)=>{
    if(e.ctrlKey) e.preventDefault();
  }, {passive:false});
})();

document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom + 0.1));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom - 0.1));
document.getElementById('zoom-fit').addEventListener('click', () => {
  const wrap = document.getElementById('canvas-wrap');
  const availW = wrap.clientWidth - 60, availH = wrap.clientHeight - 60;
  setZoom(Math.min(availW / STAGE_W, availH / STAGE_H));
});

/* ============================================================
   ТУЛБАР: добавление элементов
   ============================================================ */

function bindToolbar(idPrefix, fileId){
  const g=(s)=>document.getElementById(idPrefix+s);
  g('add-menu')?.addEventListener('click', ()=>addLayer('menu'));
  g('add-progress')?.addEventListener('click', ()=>addLayer('progress'));
  g('add-circular')?.addEventListener('click', ()=>addLayer('circular'));
  g('add-label')?.addEventListener('click', ()=>addLayer('label'));
  g('add-box')?.addEventListener('click', ()=>addLayer('box'));
  g('add-image')?.addEventListener('click', ()=>{
    const l=addLayer('image');
    const fi=document.getElementById(fileId);
    if(!fi) return;
    fi.click();
    fi.onchange=(e)=>{
      const f=e.target.files[0]; if(!f) return;
      handlePickedImageFile(f, (url) => {
        l.imgUrl=url; l.name='Картинка: '+f.name; cacheImage(url); renderAll();
      });
    };
  });
}
bindToolbar('btn-','file-image-layer');
bindToolbar('tb-','tb-image-file');

/* ============================================================
   ФАЙЛ: New / Save / Open / Export PNG
   ============================================================ */

function serializeProject() {
  return JSON.stringify({
    version: 2,
    stageW: STAGE_W, stageH: STAGE_H,
    bgColor, bgImageUrl,
    layers, osEntries, theme,
  }, null, 2);
}

function newProject() {
  if (!confirm('Создать новый проект? Несохранённые изменения будут потеряны.')) return;
  layers = []; selectedId = null; idCounter = 1;
  bgImage = null; bgImageUrl = null; bgColor = '#000000';
  osEntries = defaultOsEntries(); osIdCounter = 3;
  projectFiles = {}; projectFonts = [];
  STAGE_W = 1920; STAGE_H = 1080;
  theme = {
    bgScaleMethod: 'stretch', bgHAlign: 'center', bgVAlign: 'center',
    titleVisible: false, titleText: '', titleFont: 'DejaVu Sans Mono Bold 28', titleColor: '#ffffff',
    terminalVisible: false, terminalBoxImg: null, terminalBorder: 12,
    terminalLeft: 10, terminalTop: 10, terminalWidth: 80, terminalHeight: 80,
    coordMode: 'percent',
  };
  resizeStage();
  renderAll(); renderOsConfig();
}

function saveProjectFile() {
  const blob = new Blob([serializeProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grub-theme-project.json';
  a.click();
}

function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      STAGE_W = data.stageW || 1920;
      STAGE_H = data.stageH || 1080;
      bgColor = data.bgColor || '#000000';
      layers = (data.layers || []).filter((l,i,arr)=> l.type!=='menu' || arr.findIndex(x=>x.type==='menu')===i);
      osEntries = data.osEntries || [];
      if (data.theme) Object.assign(theme, data.theme);
      idCounter = Math.max(1, ...layers.map(l => l.id + 1), 1);
      osIdCounter = Math.max(1, ...osEntries.map(e => e.id + 1), 1);
      selectedId = null;
      // пути шрифтов из их имён: projectFonts восстанавливаем как «ожидаемые имена»
      // (сами .pf2 бинарно в JSON не лежат — их нужно подкинуть через дерево проекта)
      projectFonts = [];
      try {
        for (const { file } of projectFontFiles()) {
          if (/\.pf2$/i.test(file)) projectFonts.push({ name: file.split('/').pop(), file, url: null });
        }
      } catch {}
      // подхватываем картинки, которые уже есть как blob-url (в рамках сессии — данные не сохраняются между вкладками)
      bgImageUrl = data.bgImageUrl || null;
      if (bgImageUrl) {
        const img = new Image();
        img.onload = () => { bgImage = img; renderAll(); };
        img.onerror = () => {
          // blob: URL из старой сессии умер (протух после перезапуска браузера/вкладки) —
          // сбрасываем, иначе theme.txt сошлётся на background.png, которого нет в архиве
          bgImage = null; bgImageUrl = null;
          renderAll();
          alert('Фоновая картинка проекта не сохраняется в JSON-файле (это ограничение браузера — blob-ссылка живёт только в текущей вкладке). После загрузки проекта выберите фон заново в «Параметры холста…».');
        };
        img.src = bgImageUrl;
      } else {
        bgImage = null;
      }
      resizeStage();
      renderAll(); renderOsConfig();
    } catch (err) {
      alert('Не удалось прочитать файл проекта: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportPng() {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'grub-theme-preview.png';
  a.click();
}

function cacheUrlsFromSlices(val){
  if(!val) return;
  if(typeof val==='string'){ cacheImage(val); return; }
  if(typeof val==='object'){
    for(const [suf,url] of Object.entries(val)) if(suf!=='__slices' && typeof url==='string') cacheImage(url);
  }
}
function collectSlicedOrSingle(map, val, prefix){
  if(!val) return;
  if(typeof val==='string'){ map[`${prefix}.png`]=val; return; }
  if(typeof val==='object'){
    for(const [suf,url] of Object.entries(val)) if(suf!=='__slices' && typeof url==='string') map[`${prefix}_${suf}.png`]=url;
  }
}
// Догрузка файла в байты для сборки ZIP. fetch() на file:// в Chrome запрещён
// (opaque origin), поэтому для ВСЕХ картинок есть фолбэк: <img> + canvas ->
// toBlob -> arrayBuffer. Это актуальный обходной путь (data:/blob: URL тоже
// проходят через canvas без taint, т.к.Origin совпадает).
function loadImageBytesViaCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        cv.toBlob(b => {
          if (!b) { reject(new Error('toBlob failed')); return; }
          b.arrayBuffer().then(ab => resolve(new Uint8Array(ab))).catch(reject);
        }, 'image/png');
      } catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error('img load failed: ' + url));
    img.src = url;
  });
}
/* ---------- Перекодировка PNG в GRUB-совместимый вид (см. комментарий в buildExportBlobs) ---------- */
function sanitizePngForGrub(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 33) return u8;
  // сигнатура PNG
  const sig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return u8;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos + 12 <= u8.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(u8[pos+4], u8[pos+5], u8[pos+6], u8[pos+7]);
    if (type === 'IHDR') ihdr = u8.slice(pos + 8, pos + 8 + 13);
    else if (type === 'IDAT') idat.push(u8.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr || !idat.length) return u8;
  const w = (ihdr[0]<<24 | ihdr[1]<<16 | ihdr[2]<<8 | ihdr[3]) >>> 0;
  const h = (ihdr[4]<<24 | ihdr[5]<<16 | ihdr[6]<<8 | ihdr[7]) >>> 0;
  const bitDepth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
  // НЕтрогаем форматы, которые наш перекодировщик не поддерживает честно:
  // interlaced (Adam7), битность != 8 — оставляем как есть (GRUB их и так не ест,
  // но перекодировать вслепую было бы хуже).
  if (interlace !== 0 || bitDepth !== 8) return u8;
  if (![0,2,3,4,6].includes(colorType)) return u8;
  const bpp = { 0:1, 2:3, 3:1, 4:2, 6:4 }[colorType];
  const stride = w * bpp;
  if (!w || !h || stride > 1<<26) return u8;
  // склеиваем IDAT
  let idatLen = 0; idat.forEach(c => idatLen += c.length);
  const idatAll = new Uint8Array(idatLen);
  let off = 0; idat.forEach(c => { idatAll.set(c, off); off += c.length; });
  let raw;
  try { raw = fflate.unzlibSync(idatAll); } catch (err) { return u8; }
  if (raw.length !== (stride + 1) * h) return u8;
  // снимаем фильтры строк (стандартный PNG-unfilter)
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = y * stride, prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = (y > 0 && i >= bpp) ? px[prev + i - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + i];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xff;
      } else if (f !== 0) return u8;
      px[row + i] = v;
    }
  }
  // пересборка: фильтр 0 (None) на каждую строку
  const out = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 0;
    out.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // level 0 = stored-блоки deflate (без Хаффмана): inflate декодера GRUB читает
  // их тривиально. ВАЖНО: НЕ level 1 — динамические/фиксированные таблицы Хаффмана
  // в декодере GRUB построены с багом и ломаются на потоках fflate (проверено
  // побайтовой эмуляцией grub-core/video/readers/png.c).
  const comp = fflate.zlibSync(out, { level: 0 });
  // CRC32 (в fflate нет публичного crc32 — считаем сами)
  let crcTable = sanitizePngForGrub._crc;
  if (!crcTable) {
    crcTable = sanitizePngForGrub._crc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  const crc32 = (data) => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const res = new Uint8Array(12 + data.length);
    const dv = new DataView(res.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) res[4 + i] = type.charCodeAt(i);
    res.set(data, 8);
    dv.setUint32(8 + data.length, crc32(res.subarray(4, 8 + data.length)));
    return res;
  };
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', comp);
  const iendChunk = chunk('IEND', new Uint8Array(0));
  const total = 8 + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  png.set(sig, 0);
  png.set(ihdrChunk, 8);
  png.set(idatChunk, 8 + ihdrChunk.length);
  png.set(iendChunk, 8 + ihdrChunk.length + idatChunk.length);
  return png;
}

async function buildExportBlobs() {
  const themeTxt = buildThemeTxt();
  const blobs = {};
  for (const l of layers) {
    collectSlicedOrSingle(blobs, l.menuBorderImg, `assets/menu-${l.id}/menu`);
    collectSlicedOrSingle(blobs, l.menuSelectedBg, `assets/menu-${l.id}/select`);
    collectSlicedOrSingle(blobs, l.menuNormalBg, `assets/menu-${l.id}/item`);
    collectSlicedOrSingle(blobs, l.scrollbarFrameImg, `assets/menu-${l.id}/scroll_frame`);
    collectSlicedOrSingle(blobs, l.scrollbarThumbImg, `assets/menu-${l.id}/scroll_thumb`);
    if (l.type === 'image' && l.imgUrl) blobs[`assets/image-${l.id}.png`] = l.imgUrl;
    if (l.type === 'box') {
      if (l.boxTextureUrl) {
        blobs[`assets/box-${l.id}.png`] = l.boxTextureUrl;
      } else {
        // PNG-заливка для box: цвет + рамка. Генерируем canvas нужного цвета
        // и кладём как blob — иначе theme.txt сошлётся на несуществующий file
        // и GRUB упадёт с "file `...box-N.png' not found" (как на вашем скриншоте).
        try {
          const bw = Math.max(1, Math.round(l.w || 64)), bh = Math.max(1, Math.round(l.h || 64));
          const bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
          const bctx = bc.getContext('2d');
          if (bctx) {
            bctx.fillStyle = l.boxColor || '#000000';
            bctx.globalAlpha = 1;
            bctx.fillRect(0, 0, bw, bh);
            if (l.boxBorder) { bctx.strokeStyle = l.boxBorder; bctx.lineWidth = 2; bctx.strokeRect(1, 1, bw - 2, bh - 2); }
            const dataUrl = bc.toDataURL('image/png');
            blobs[`assets/box-${l.id}.png`] = dataUrl;
          }
        } catch {}
      }
    }
    if (l.type === 'circular') {
      if (l.centerBitmap) blobs[`assets/circular-${l.id}/center.png`] = l.centerBitmap;
      if (l.tickBitmap) blobs[`assets/circular-${l.id}/tick.png`] = l.tickBitmap;
    }
    if (l.type === 'progress') {
      collectSlicedOrSingle(blobs, l.barStyleImg, `assets/progress-${l.id}/frame`);
      collectSlicedOrSingle(blobs, l.highlightStyleImg, `assets/progress-${l.id}/highlight`);
    }
  }
  if (bgImageUrl && bgImage && bgImage.complete && bgImage.naturalWidth > 0) blobs['background.png'] = bgImageUrl;
  if (theme.terminalBoxImg) {
    if (typeof theme.terminalBoxImg === 'object') collectSlicedOrSingle(blobs, theme.terminalBoxImg, 'assets/terminal_box/terminal');
    else blobs['terminal_box.png'] = theme.terminalBoxImg;
  }
  // иконки ос: GRUB подбирает иконку по классу menuentry --class <cls>,
  // поэтому имя файла ДОЛЖНО совпадать с классом: icons/<class>.png.
  // Если у записи своей иконки нет — кладём в тему встроенную дефолтную
  // (default-icons/<class>.png), иначе в билде иконок не будет вовсе.
  for (let i = 0; i < osEntries.length; i++) {
    const e = osEntries[i];
    const cls = e.osClass || ('os' + (i + 1));
    let src = e.normalImg;
    if (!src) {
      const dcls = defaultIconClassFor(e);
      if (dcls) src = getDefaultIconUrl(dcls);
    }
    if (src) blobs[`icons/${cls}.png`] = src;
  }
  // ВАЖНО: кладём в экспорт ВСЮ встроенную библиотеку иконок, а не только иконки
  // текущих ос-записей. Реальный grub.cfg на машине генерирует menuentry с
  // десятками разных --class (arch, fedora, memtest, recovery, ...), и GRUB
  // молча рисует пункт «без иконки», если icons/<class>.png в теме нет.
  // Библиотека встроена в редактор (default-icons-data.js) и весит десятки КБ —
  // включаем её целиком. Иконки, заданные пользователем вручную (выше), не
  // перетираем: приоритет у пользовательских.
  for (const dcls of DEFAULT_ICON_CLASSES) {
    const durl = await loadDefaultIconDataUrl(dcls);
    if (durl && !blobs[`icons/${dcls}.png`]) blobs[`icons/${dcls}.png`] = durl;
  }
  // файлы-алиасы классов: GRUB ищет icons/<класс>.png по точному имени из
  // --class, поэтому для вариантов (macos/osx → macosx, memtest86* → memtest)
  // кладём копию иконки под всеми альтернативными именами.
  for (const [alias, canon] of Object.entries(ICON_CLASS_ALIASES)) {
    const akey = `icons/${alias}.png`, ckey = `icons/${canon}.png`;
    if (!blobs[akey] && blobs[ckey]) blobs[akey] = blobs[ckey];
  }
  // шрифты .pf2: то, что пришло с импортом (projectFiles) + загруженное пользователем (projectFonts,
  // включая шрифты, автоматически зарегистрированные при импорте архива под их реальными путями)
  Object.keys(projectFiles).forEach(k => {
    if (/\.pf2$/i.test(k)) blobs[k] = projectFiles[k];
  });
  // ROUND-TRIP: все остальные файлы из импортированного архива (иконки классов без записей,
  // info_grub.png и пр.) тоже кладём в экспорт как есть — тема должна выезжать обратно
  // в том же составе, а не терять файлы, которые редактор «не понял».
  Object.keys(projectFiles).forEach(k => {
    if (/^theme\.txt$/i.test(k)) return; // theme.txt генерируем заново
    if (!blobs[k]) blobs[k] = projectFiles[k];
  });
  for (const f of projectFonts) {
    if (f.url && !blobs[f.file]) blobs[f.file] = f.url;
  }
  // Шрифты, которые тема РЕАЛЬНО использует (item_font/title-font/font...), но для которых
  // нет ни одного загруженного .pf2 файла с таким именем — честно предупреждаем, вместо того
  // чтобы молча подсунуть первый попавшийся .pf2 (тот же класс проблемы, что был с рамкой
  // меню: GRUB получит файл, который не совпадает с тем, что написано в theme.txt по смыслу,
  // и либо покажет не тот шрифт/размер, либо просто его не найдёт).
  const missingFonts = [];
  {
    const pf2keys = Object.keys(blobs).filter(k => /\.pf2$/i.test(k));
    for (const { font, file, missing } of projectFontFiles()) {
      if (blobs[file]) continue; // уже есть настоящий файл под этим путём
      if (missing) {
        missingFonts.push(`${font} — нет загруженного .pf2, будет использован приблизительный шрифт вместо него`);
        // всё равно подставляем любой существующий .pf2, чтобы GRUB не упал на дефолт целиком —
        // но пользователь теперь ЯВНО предупреждён, что это не точное совпадение.
        if (pf2keys.length) {
          const fam = file.split('/').pop().split('-')[0];
          const same = pf2keys.find(k => k.toLowerCase().includes('/' + fam));
          blobs[file] = blobs[same || pf2keys[0]];
        }
      }
    }
  }
  // догружаем blob'и как Uint8Array
  const files = { 'theme.txt': fflate.strToU8(themeTxt) };
  const failedPaths = [];
  for (const [path, url] of Object.entries(blobs)) {
    try {
      let buf = null;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch not ok');
        buf = await res.arrayBuffer();
      } catch (err) {
        // fetch() может быть заблокирован (file:// relative path, строгий CSP и т.п.)
        // — для картинок берём байты через <img>+canvas, это работает всегда
        if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(path)) throw err;
        buf = (await loadImageBytesViaCanvas(url)).buffer;
      }
      files[path] = new Uint8Array(buf);
    } catch {
      failedPaths.push(path);
    }
  }
  // ВАЖНО: если картинка (фон, рамка меню, подложка пункта, скроллбар, terminal-box и т.п.)
  // не удалось получить (протухший blob-URL после перезагрузки/повторной загрузки проекта из JSON,
  // импортированная тема без файлов и т.д.) — GRUB эту ссылку в реальности НЕ найдёт и молча
  // откатится на дефолт (голый текст без рамки/иконок), при этом сам редактор мог всё это время
  // рисовать картинку из старого imgCache и создавать иллюзию, что всё работает.
  // Поэтому здесь мы вычищаем из theme.txt КАЖДУЮ ссылку на файл, которого реально нет в архиве —
  // не только для фона, — и явно предупреждаем пользователя, что именно было вырезано.
  const sanitizeWarnings = [];
  // Неизвестные глобальные ключи из импорта дописываем ПЕРЕД санитайзером — тоже как
  // СТРОКИ В КАВЫЧКАХ (парсер тем GRUB требует закавыченных значений для глобальных
  // свойств; незакавыченное значение вне блоков = "property value invalid" и смерть всей темы).
  let unknownGlobalLines = '';
  Object.keys(theme.unknownGlobals || {}).forEach(k => {
    const v = String(theme.unknownGlobals[k]).replace(/"/g, '');
    unknownGlobalLines += `${k}: "${v}"\n`;
  });
  let finalThemeTxt = unknownGlobalLines + themeTxt;
  {
    // Паттерны, пришедшие ИЗ ИМПОРТИРОВАННОЙ темы как есть. Если файлы под них и в
    // исходной теме не существовали (частый случай: terminal-box: "terminal_box_*.png"
    // без самих файлов — GRUB такое терпит и просто не рисует terminal-box), то
    // вырезать эту строку и пугать пользователя НЕЛЬЗЯ — иначе честный
    // "импорт -> экспорт без изменений" давал ложное предупреждение.
    const importedPatterns = new Set();
    if (theme.terminalBoxPattern) importedPatterns.add(String(theme.terminalBoxPattern).toLowerCase());
    layers.forEach(l => ['menuBorderPattern','menuNormalPattern','menuSelectedPattern','scrollbarFramePattern','scrollbarThumbPattern','barStylePattern','highlightStylePattern','imgPattern'].forEach(pk => {
      if (l[pk]) importedPatterns.add(String(l[pk]).toLowerCase());
    }));
    // ключи-свойства theme.txt, которые ссылаются на путь к файлу(ам)
    const fileRefProps = [
      'desktop-image', 'terminal-box',
      'menu_pixmap_style', 'item_pixmap_style', 'selected_item_pixmap_style',
      'scrollbar_frame', 'scrollbar_thumb'
    ];
    const lines = finalThemeTxt.split('\n');
    const keptLines = [];
    for (const line of lines) {
      const m = line.match(/^(\s*)([a-zA-Z_-]+)\s*[:=]\s*"([^"]+)"/);
      if (m && fileRefProps.includes(m[2])) {
        const pattern = m[3];
        // если это 9-slice (содержит *), файл может называться иначе для каждого куска —
        // проверяем, есть ли ХОТЯ БЫ ОДИН файл в архиве, чей путь ИЛИ ИМЯ ФАЙЛА (без папок,
        // как GRUB видит пути относительно папки темы) совпадает с этим паттерном
        if (importedPatterns.has(pattern.toLowerCase())) { keptLines.push(line); continue; }
        const isWildcard = pattern.includes('*');
        const wildcardRe = isWildcard
          ? new RegExp(pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i')
          : null;
        const found = isWildcard
          ? Object.keys(files).some(k => {
              // сравниваем и полный путь, и имя файла без папок — GRUB ищет относительно theme.txt,
              // а файлы в экспорте могут лежать в подпапках (assets/...)
              const base = k.slice(Math.max(k.lastIndexOf('/'), k.lastIndexOf('\\')) + 1);
              return wildcardRe.test(k) || wildcardRe.test(base);
            })
          : Object.keys(files).some(k => k.toLowerCase() === pattern.toLowerCase()
              || k.slice(Math.max(k.lastIndexOf('/'), k.lastIndexOf('\\')) + 1).toLowerCase() === pattern.toLowerCase());
        if (!found) {
          sanitizeWarnings.push(`${m[2]} = "${pattern}" — файл отсутствует в экспорте, строка удалена (иначе GRUB тихо откатился бы на дефолт без предупреждения)`);
          continue; // строку не сохраняем
        }
      }
      keptLines.push(line);
    }
    finalThemeTxt = keptLines.join('\n');
  }
  files['theme.txt'] = fflate.strToU8(finalThemeTxt);
  // подчищаем из files все blob'ы, которые реально не скачались (fetch упал)
  for (const p of failedPaths) delete files[p];
  // дублируем theme.txt-пути без wildcard на реальные выгруженные assets:
  // если theme.txt ссылается на imgPattern (напр. "info.png"), а blob лежит в assets/image-N.png —
  // добавляем копию файла под исходным именем, чтобы GRUB его нашёл.
  const extraCopies = {};
  layers.forEach(l => {
    if (l.type === 'image' && l.imgPattern && l.imgUrl) {
      const hasReal = Object.keys(files).some(k => k.toLowerCase() === String(l.imgPattern).toLowerCase());
      if (!hasReal) {
        const realKey = Object.keys(files).find(k => k.toLowerCase() === `assets/image-${l.id}.png`.toLowerCase());
        if (realKey) extraCopies[l.imgPattern] = files[realKey];
      }
    }
  });
  Object.assign(files, extraCopies);
  // ЗАЩИТА ОТ БАГА GRUB "error: invalid filter value."
  // Собственный inflate декодера PNG в GRUB (grub-core/video/readers/png.c) не
  // переваривает часть стандартных deflate-потоков (например, PNG, сжатые
  // браузерным canvas.toBlob или pnglib с адаптивными фильтрами строк и
  // сложными таблицами Хаффмана) — на реальной машине тема падает с
  // "error: invalid filter value" и "Press any key to continue".
  // Поэтому ПЕРЕД упаковкой в ZIP каждый PNG перекодируется в заведомо
  // безопасный для GRUB вид: разжимаем → снимаем фильтры строк → запаковываем
  // заново со всеми фильтрами = 0 (None) и zlib level 1 (простые блоки deflate).
  // Проверено эмуляцией декодера GRUB: такие файлы он читает корректно.
  for (const k of Object.keys(files)) {
    if (/\.png$/i.test(k)) {
      try { files[k] = sanitizePngForGrub(files[k]); }
      catch (err) { console.error('sanitizePngForGrub failed for', k, err); }
    }
  }
  return { files, themeTxt: finalThemeTxt, bgFailed: failedPaths.includes('background.png'), sanitizeWarnings, missingFonts };
}

async function exportZip() {
  const { files, sanitizeWarnings, missingFonts, failedPaths } = await buildExportBlobs();
  if (failedPaths && failedPaths.length) console.error('Экспорт: файлы не попали в ZIP:', failedPaths);
  const allWarnings = [
    ...(sanitizeWarnings || []),
    ...(missingFonts || []),
    // не прячем молча: если какие-то файлы не удалось положить в ZIP — показываем явно
    ...(failedPaths && failedPaths.length
      ? [`Не удалось положить в ZIP: ${failedPaths.join(', ')}`]
      : [])
  ];
  if (allWarnings.length) {
    alert(
      'Внимание: часть файлов, на которые ссылается тема, реально отсутствует в экспорте:\n\n' +
      allWarnings.map(w => '• ' + w).join('\n') +
      '\n\nЗагрузите недостающие PNG/.pf2 в соответствующем слое/панели и экспортируйте снова.'
    );
  }
  const zipped = fflate.zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grub-theme.zip';
  a.click();
}
document.getElementById('btn-export-zip').addEventListener('click', exportZip);

/* ============================================================
   ИМПОРТ РЕАЛЬНОЙ ТЕМЫ GRUB (theme.txt + assets)
   ============================================================ */

// --- 1. Токенизация/парсинг theme.txt в дерево блоков ---
// Формат: глобальные "key: value" / key = value строки + блоки "+ type { ... }"
// Значения координат бывают "25%", "10", "25%+10" (проценты со сдвигом в px) — сохраняем как строку raw
// и параллельно вычисляем px для текущего холста при импорте.

function parseThemeTxt(text) {
  const lines = text.split(/\r?\n/);
  const globals = {};
  const blocks = [];
  let i = 0;

  function stripComment(line) {
    // grub комментарии начинаются с # (полная строка или после значения — берём аккуратно только полнострочные)
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return '';
    return line;
  }

  function parseKeyValue(line) {
    // поддерживает: key: "value"   key = "value"   key = value   key=value
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*[:=]\s*(.+?)\s*$/);
    if (!m) return null;
    let [, key, val] = m;
    val = val.trim();
    if (val.endsWith(';')) val = val.slice(0, -1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return { key, val };
  }

  while (i < lines.length) {
    let raw = stripComment(lines[i]);
    const trimmed = raw.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith('+')) {
      // + blockname {
      const m = trimmed.match(/^\+\s*([A-Za-z0-9_]+)\s*\{?/);
      const blockType = m ? m[1] : 'unknown';
      const block = { type: blockType, props: {}, raw: [] };
      // если "{" не на этой же строке — ищем на следующих
      let depth = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
      i++;
      while (i < lines.length && depth > 0) {
        const bl = stripComment(lines[i]);
        const bt = bl.trim();
        depth += (bt.match(/\{/g) || []).length - (bt.match(/\}/g) || []).length;
        if (depth <= 0) { i++; break; }
        if (bt) {
          const kv = parseKeyValue(bt);
          if (kv) block.props[kv.key] = kv.val;
          else block.raw.push(bt);
        }
        i++;
      }
      blocks.push(block);
      continue;
    }

    const kv = parseKeyValue(trimmed);
    if (kv) globals[kv.key] = kv.val;
    i++;
  }

  return { globals, blocks };
}

// --- 2. Координаты: "25%" | "10" | "25%+10" | "-10" -> px, с учётом базы (ширина/высота холста) ---
function coordToPx(raw, base) {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)%(?:([+-]\d+(?:\.\d+)?))?$/);
  if (m) {
    const pct = parseFloat(m[1]) / 100 * base;
    const off = m[2] ? parseFloat(m[2]) : 0;
    return Math.round(pct + off);
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

// --- 3. Парсинг строки шрифта: "Comic Sans MS Regular 16" -> {name:"Comic Sans MS", bold:false, size:16} ---
function parseFontString(s) {
  if (!s) return { name: 'Sans', bold: false, size: 16 };
  const m = s.trim().match(/^(.*?)\s+(Bold|Regular)\s+(\d+)$/i);
  if (m) return { name: m[1].trim() || 'Sans', bold: /bold/i.test(m[2]), size: parseInt(m[3], 10) };
  // без явного веса — берём как есть, вес Regular
  const m2 = s.trim().match(/^(.*?)\s+(\d+)$/);
  if (m2) return { name: m2[1].trim() || 'Sans', bold: false, size: parseInt(m2[2], 10) };
  return { name: s, bold: false, size: 16 };
}

// --- 4. Разбор паттерна "name_*.png" на суффиксы nw/n/ne/w/c/e/sw/s/se,
//     сопоставляя с реально присутствующими файлами (по имени, без пути). ---
const NINE_SUFFIXES = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];
function resolveSlicedPattern(pattern, fileMap) {
  // pattern пример: "select_*.png" или просто "select_*"
  // Поддерживает и паттерн без wildcard — тогда это одиночный файл (plain path).
  const m = pattern.match(/^(.*)\*(\.[A-Za-z0-9]+)?$/);
  if (!m) {
    // паттерн без wildcard — одиночный файл
    const url = lookupFile(fileMap, pattern);
    return url || null; // строка-URL одиночной картинки, либо null
  }
  const prefix = m[1];
  const ext = m[2] || '.png';
  const slices = { __slices: true };
  let any = false;
  NINE_SUFFIXES.forEach(suf => {
    const fname = `${prefix}${suf}${ext}`;
    const url = fileMapGet(fileMap, fname);
    if (url) { slices[suf] = url; any = true; }
  });
  if (any) return slices;
  // fallback: одиночный файл prefix.png (без суффикса). GRUB wildcard name_*.png
  // НЕ подхватывает одиночный name.png, поэтому возвращаем как single image (строку),
  // а экспорт запишет путь БЕЗ wildcard — тогда GRUB масштабирует центр.
  for (const cand of [`${prefix}.png`, `${prefix}${ext}`]) {
    const url = fileMapGet(fileMap, cand);
    if (url) return url;
  }
  return null;
}

// --- 5. Основная функция импорта: принимает FileList (папка, webkitdirectory) ---
function importThemeFolder(fileList) {
  const files = Array.from(fileList);
  const themeFile = files.find(f => /(^|\/)theme\.txt$/i.test(f.webkitRelativePath || f.name));
  if (!themeFile) { alert('В выбранной папке не найден theme.txt'); return; }

  // строим карту "относительное имя файла (lowercase, без корневой папки темы)" -> blob URL
  const root = themeFile.webkitRelativePath ? themeFile.webkitRelativePath.split('/').slice(0, -1).join('/') : '';
  projectFiles = {};
  const fileMap = projectFiles;

  files.forEach(f => {
    let rel = f.webkitRelativePath || f.name;
    if (root && rel.startsWith(root + '/')) rel = rel.slice(root.length + 1);
    fileMap[rel] = URL.createObjectURL(f);
  });

  const themeReader = new FileReader();
  themeReader.onload = () => {
    try {
      applyParsedTheme(parseThemeTxt(themeReader.result), fileMap);
    } catch (err) {
      alert('Ошибка разбора theme.txt: ' + err.message);
      console.error(err);
    }
  };
  themeReader.readAsText(themeFile);
}

function lookupFile(fileMap, relPath) {
  if (!relPath) return null;
  // theme.txt пути обычно относительные, без ведущего ./
  return fileMapGet(fileMap, relPath.replace(/^\.\//, ''));
}

/* ============================================================
   ИМПОРТ ИЗ АРХИВА (.zip / .tar / .tar.gz)
   Работает целиком в браузере: fflate (inline, без внешнего CDN)
   разжимает zip/gzip, а tar-контейнер разбирается своим мини-парсером
   (формат простой — заголовки по 512 байт, доп. библиотека не нужна).
   ============================================================ */

// --- мини-парсер TAR (POSIX ustar, тот же формат что использует GNU tar) ---
// Возвращает массив { name, data: Uint8Array }
function parseTar(buf) {
  const files = [];
  let offset = 0;
  const dec = new TextDecoder('utf-8');
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // пустой блок (все нули) — конец архива
    if (header.every(b => b === 0)) break;

    const readStr = (start, len) => dec.decode(header.subarray(start, start + len)).replace(/\0.*$/s, '').trim();
    const name = readStr(0, 100);
    const sizeOctal = readStr(124, 12);
    const typeFlag = String.fromCharCode(header[156]);
    const prefix = readStr(345, 155);
    const size = parseInt(sizeOctal, 8) || 0;
    const fullName = prefix ? `${prefix}/${name}` : name;

    offset += 512;
    if (!fullName) { offset += Math.ceil(size / 512) * 512; continue; }

    // typeFlag '0' или '\0' — обычный файл; '5' — директория (пропускаем содержимое)
    if ((typeFlag === '0' || typeFlag === '\0') && size > 0) {
      const data = buf.subarray(offset, offset + size);
      files.push({ name: fullName, data: new Uint8Array(data) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

// --- строит fileMap (rel -> blobURL, ОРИГИНАЛЬНЫЙ регистр имён сохраняется!) из массива {name, data} с общим корнем ---
// Регистр важен: GRUB ищет иконки/шрифты по точному имени файла (icons/SystemRescueCD.png),
// а раньше ключи приводились к lowercase и экспорт молча менял SystemRescueCD.png -> systemrescuecd.png.
function buildFileMapFromEntries(entries) {
  // находим theme.txt, чтобы определить корневую папку темы внутри архива
  const themeEntry = entries.find(e => /(^|\/)theme\.txt$/i.test(e.name));
  if (!themeEntry) return null;
  const root = themeEntry.name.includes('/') ? themeEntry.name.split('/').slice(0, -1).join('/') : '';

  const fileMap = {};
  entries.forEach(e => {
    let rel = e.name;
    if (root && rel.startsWith(root + '/')) rel = rel.slice(root.length + 1);
    else if (root && rel === root) return;
    if (!rel) return;
    const blob = new Blob([e.data]);
    fileMap[rel] = URL.createObjectURL(blob);
  });
  return { fileMap, themeText: new TextDecoder('utf-8').decode(themeEntry.data) };
}

// регистронезависимое чтение из fileMap (пути в theme.txt могут отличаться регистром от имён файлов)
function fileMapGet(fileMap, key) {
  if (!fileMap || !key) return null;
  if (fileMap[key]) return fileMap[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(fileMap).find(k => k.toLowerCase() === lower);
  return hit ? fileMap[hit] : null;
}

function importThemeFromZip(arrayBuffer) {
  try {
    const unzipped = fflate.unzipSync(new Uint8Array(arrayBuffer));
    const entries = Object.keys(unzipped)
      .filter(name => !name.endsWith('/')) // пропускаем записи-директории
      .map(name => ({ name, data: unzipped[name] }));
    const result = buildFileMapFromEntries(entries);
    if (!result) { alert('В архиве не найден theme.txt'); return; }
    applyParsedTheme(parseThemeTxt(result.themeText), result.fileMap);
  } catch (err) {
    alert('Не удалось распаковать zip-архив: ' + err.message);
    console.error(err);
  }
}

function importThemeFromTar(arrayBuffer) {
  try {
    const entries = parseTar(new Uint8Array(arrayBuffer));
    const result = buildFileMapFromEntries(entries);
    if (!result) { alert('В архиве не найден theme.txt'); return; }
    applyParsedTheme(parseThemeTxt(result.themeText), result.fileMap);
  } catch (err) {
    alert('Не удалось разобрать tar-архив: ' + err.message);
    console.error(err);
  }
}

function importThemeFromTarGz(arrayBuffer) {
  try {
    const decompressed = fflate.decompressSync(new Uint8Array(arrayBuffer)); // сам определяет gzip/zlib/deflate
    importThemeFromTar(decompressed.buffer);
  } catch (err) {
    alert('Не удалось распаковать .tar.gz: ' + err.message);
    console.error(err);
  }
}

// --- единая точка входа: определяет формат по расширению файла ---
function importThemeFromArchiveFile(file) {
  const name = file.name.toLowerCase();
  const reader = new FileReader();
  reader.onload = () => {
    const buf = reader.result;
    if (name.endsWith('.zip')) {
      importThemeFromZip(buf);
    } else if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
      importThemeFromTarGz(buf);
    } else if (name.endsWith('.tar')) {
      importThemeFromTar(buf);
    } else if (name.endsWith('.gz')) {
      // .gz без .tar в имени — пробуем как tar.gz (частый случай: theme.tar.gz иногда режут расширение при скачивании)
      importThemeFromTarGz(buf);
    } else {
      alert('Формат архива не распознан. Поддерживаются: .zip, .tar, .tar.gz, .tgz');
    }
  };
  reader.onerror = () => alert('Не удалось прочитать файл архива.');
  reader.readAsArrayBuffer(file);
}

function autoCreateOsEntriesFromIcons(fileMap) {
  const iconKeys = Object.keys(fileMap).filter(k => k.toLowerCase().includes('icons/'));
  if (iconKeys.length === 0) return;
  // ВАЖНО: берём ВСЕ иконки из папки icons/ — в реальных темах их бывают десятки и сотни,
  // и ранний лимит "известных дистрибутивов + максимум 5-6" молча терял остальные.
  // Служебные иконки тем (не соответствующие ни одной ОС) тоже включаем — их легко удалить,
  // а вот потерянные при импорте иконки заметить гораздо сложнее.
  const service = /^(unknown|submenu|cancel|placeholder|generic|blank|transparent)([-_.].*)?$/i;
  const picked = iconKeys
    .filter(k => /\.(png|svg)$/i.test(k))
    .filter(k => {
      const base = k.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      return !service.test(base);
    })
    .sort();
  picked.forEach(rel => {
    const fileName = rel.split('/').pop();
    const base = fileName.replace(/\.[^.]+$/, '');
    const url = fileMap[rel];
    osEntries.push({ id: osIdCounter++, name: base, osClass: base, normalImg: url, selectedImg: url, normalName: fileName, selectedName: fileName });
    cacheImage(url);
  });
}

function applyParsedTheme(parsed, fileMap) {
  const { globals, blocks } = parsed;

  // --- определяем разрешение холста ---
  // приоритет: явные global width/height (нестандартно, но бывает) -> размер background.png -> дефолт 1920x1080
  let newW = STAGE_W, newH = STAGE_H;
  const bgUrl = lookupFile(fileMap, globals['desktop-image']);

  const finishImport = () => {
    STAGE_W = newW; STAGE_H = newH;

    layers = [];
    idCounter = 1;
    osEntries = [];
    osIdCounter = 1;
    selectedId = null;
    projectFonts = [];

    // Регистрируем ВСЕ .pf2 файлы темы в projectFonts с их ТОЧНЫМ путём (fileMap ключи —
    // оригинальные относительные пути архива, lowercase) — так экспорт сможет сослаться
    // на реальный файл вместо придуманного редактором имени. Настоящее имя шрифта
    // (что должно идти в item_font/title-font и т.п.) читаем из бинарного заголовка .pf2,
    // асинхронно; пока чтение идёт, слои используют имя, разобранное прямо из theme.txt
    // (см. ниже itemFontRef) — оно и так корректно, чтение .pf2 лишь уточняет данные
    // для инспектора и на случай ручного создания темы с нуля.
    Object.keys(fileMap).forEach(relLower => {
      if (!/\.pf2$/i.test(relLower)) return;
      const url = fileMap[relLower];
      fetch(url).then(r => r.blob()).then(blob => {
        const asFile = new File([blob], relLower.split('/').pop(), { type: 'application/octet-stream' });
        return readPf2FontName(asFile);
      }).then(name => {
        if (!name) name = guessFontNameFromFileName(relLower.split('/').pop());
        if (!projectFonts.some(pf => pf.file.toLowerCase() === relLower)) {
          projectFonts.push({ name, file: relLower, url, realFile: true });
          renderInspector();
        }
      }).catch(() => {});
    });

    // --- глобальные свойства темы ---
    bgColor = globals['desktop-color'] || '#000000';
    if (bgUrl) {
      bgImageUrl = bgUrl;
      cacheImage(bgUrl, (img) => { bgImage = img; renderAll(); });
    } else {
      bgImage = null; bgImageUrl = null;
    }

    theme.titleVisible = !!(globals['title-text'] && globals['title-text'].trim());
    theme.titleText = globals['title-text'] || '';
    if (globals['title-font']) {
      // сохраняем ТОЧНУЮ строку шрифта из импортированной темы как есть — это и есть
      // то самое имя, под которым GRUB найдёт .pf2 (или уже нашёл в оригинале), не пересобираем.
      theme.titleFont = globals['title-font'];
    }
    theme.titleColor = globals['title-color'] || theme.titleColor;

    const termBoxPattern = globals['terminal-box'];
    theme.terminalVisible = !!termBoxPattern || globals['terminal-left'] !== undefined;
    if (termBoxPattern) {
      const slices = resolveSlicedPattern(termBoxPattern, fileMap);
      if (slices) {
        theme.terminalBoxImg = slices;
        cacheUrlsFromSlices(slices);
      } else {
        // не смогли сматчить раздельные файлы — оставляем как есть (сохраняем паттерн для round-trip)
        theme.terminalBoxImg = null;
      }
      theme.terminalBoxPattern = termBoxPattern; // для честного round-trip даже если файлы не найдены
    }
    if (globals['terminal-left'] !== undefined) theme.terminalLeft = parseFloat(globals['terminal-left']) || 0;
    if (globals['terminal-top'] !== undefined) theme.terminalTop = parseFloat(globals['terminal-top']) || 0;
    if (globals['terminal-width'] !== undefined) theme.terminalWidth = parseFloat(globals['terminal-width']) || 100;
    if (globals['terminal-height'] !== undefined) theme.terminalHeight = parseFloat(globals['terminal-height']) || 100;
    if (globals['terminal-border'] !== undefined) theme.terminalBorder = parseFloat(globals['terminal-border']) || 0;

    // сохраняем нераспознанные глобальные ключи как есть, для честного round-trip
    theme.unknownGlobals = {};
    Object.keys(globals).forEach(k => {
      if (!['title-text','title-font','title-color','desktop-image','desktop-color',
            'terminal-box','terminal-left','terminal-top','terminal-width','terminal-height','terminal-border',
            'terminal-font'].includes(k)) {
        theme.unknownGlobals[k] = globals[k];
      }
    });
    if (globals['terminal-font']) theme.terminalFont = globals['terminal-font'];

    // --- блоки ---
    blocks.forEach(block => {
      const p = block.props;
      const x = coordToPx(p.left, newW), y = coordToPx(p.top, newH);
      const w = p.width !== undefined ? coordToPx(p.width, newW) : 200;
      const h = p.height !== undefined ? coordToPx(p.height, newH) : 60;

      if (block.type === 'boot_menu') {
        if(layers.some(l=>l.type==='menu')) return;
        const l = makeLayer('menu', { x, y, w, h });
        if (p.item_font) {
          const f = parseFontString(p.item_font);
          l.fontName = f.name; l.fontSize = f.size; l.fontBold = f.bold;
          l.itemFontRef = p.item_font; // точная строка из оригинала — используется при экспорте как есть
        }
        if (p.selected_item_font) {
          const f = parseFontString(p.selected_item_font);
          l.selectedFontSize = f.size;
          l.selectedItemFontRef = p.selected_item_font; // отдельный шрифт для выбранного пункта БЫЛ в оригинале
          l.hasSeparateSelectedFont = true;
        } else {
          // GRUB-темы часто вообще не задают selected_item_font — тогда GRUB использует
          // item_font для обоих состояний, различая их только цветом (item_color/selected_item_color).
          // Раньше редактор ВСЕГДА досочинял "... Bold N" для выбранного, даже если в оригинале
          // этого не было и такого .pf2-файла может не существовать вовсе — это и есть баг,
          // из-за которого повторный экспорт темы без Bold-варианта шрифта ломался.
          l.hasSeparateSelectedFont = false;
        }
        if (p.item_color) l.color = p.item_color;
        if (p.selected_item_color) l.selectedColor = p.selected_item_color;
        if (p.icon_width) l.iconWidth = parseInt(p.icon_width, 10);
        if (p.icon_height) l.iconHeight = parseInt(p.icon_height, 10);
        if (p.item_icon_space) l.itemIconSpace = parseInt(p.item_icon_space, 10);
        if (p.item_height) l.itemHeight = parseInt(p.item_height, 10);
        if (p.item_padding) l.itemPadding = parseInt(p.item_padding, 10);
        if (p.item_spacing) l.itemSpacing = parseInt(p.item_spacing, 10);
        if (p.max_items_shown) l.maxItemsShown = parseInt(p.max_items_shown, 10);
        if (p.scrollbar) l.scrollbarEnabled = p.scrollbar === 'true';
        if (p.scrollbar_thumb_overlay) l.scrollbarThumbOverlay = p.scrollbar_thumb_overlay === 'true';
        if (p.scrollbar_slice) l.scrollbarSlice = p.scrollbar_slice;
        if (p.scrollbar_left_pad) l.scrollbarLeftPad = parseInt(p.scrollbar_left_pad, 10);
        if (p.scrollbar_right_pad) l.scrollbarRightPad = parseInt(p.scrollbar_right_pad, 10);
        if (p.scrollbar_top_pad) l.scrollbarTopPad = parseInt(p.scrollbar_top_pad, 10);
        if (p.scrollbar_bottom_pad) l.scrollbarBottomPad = parseInt(p.scrollbar_bottom_pad, 10);
        if (p.scrollbar_frame) {
          const s = resolveSlicedPattern(p.scrollbar_frame, fileMap);
          if (s) { l.scrollbarFrameImg = s; cacheUrlsFromSlices(s); }
          l.scrollbarFramePattern = p.scrollbar_frame;
        }
        if (p.scrollbar_thumb) {
          const s = resolveSlicedPattern(p.scrollbar_thumb, fileMap);
          if (s) { l.scrollbarThumbImg = s; cacheUrlsFromSlices(s); }
          l.scrollbarThumbPattern = p.scrollbar_thumb;
        }
        if (p.menu_pixmap_style) {
          const slices = resolveSlicedPattern(p.menu_pixmap_style, fileMap);
          if (slices) { l.menuBorderImg = slices; cacheUrlsFromSlices(slices); }
        }
        if (p.item_pixmap_style) {
          const slices = resolveSlicedPattern(p.item_pixmap_style, fileMap);
          if (slices) { l.menuNormalBg = slices; cacheUrlsFromSlices(slices); }
        }
        if (p.selected_item_pixmap_style) {
          const slices = resolveSlicedPattern(p.selected_item_pixmap_style, fileMap);
          if (slices) { l.menuSelectedBg = slices; cacheUrlsFromSlices(slices); }
        }
        // сохраняем исходные паттерны для честного экспорта, даже если файлы не были найдены
        l.menuBorderPattern = p.menu_pixmap_style || null;
        l.menuNormalPattern = p.item_pixmap_style || null;
        l.menuSelectedPattern = p.selected_item_pixmap_style || null;

        l.name = defaultName(l);
        layers.push(l);
      }

      else if (block.type === 'label') {
        const lw = p.width !== undefined ? coordToPx(p.width, newW) : 400;
        const l = makeLayer('label', { x, y, w: lw, h: 40, text: p.text || '' });
        if (p.font) {
          const f = parseFontString(p.font);
          l.fontName = f.name; l.fontBold = f.bold; l.fontSize = f.size;
          l.fontRef = p.font; // точная строка шрифта из оригинала — используется при экспорте как есть
        }
        if (p.color) l.color = p.color;
        if (p.align) l.align = p.align;
        if (p.id === '__timeout__') l.useTimeoutId = true;
        l.name = defaultName(l);
        layers.push(l);
      }

      else if (block.type === 'progress_bar') {
        const l = makeLayer('progress', { x, y, w, h: h || 28 });
        if (p.fg_color) l.barColor = p.fg_color;
        if (p.bg_color) l.barBg = p.bg_color;
        // border_color раньше не читался вовсе (экспорт писал фиксированное "#ffffff"
        // независимо от того, что реально было в оригинале, или от того, что не было вовсе)
        if (p.border_color) { l.barBorderColor = p.border_color; l.hasBorderColor = true; }
        else l.hasBorderColor = false;
        if (p.show_text === 'true') l.showBarText = true;
        if (p.text) l.barText = p.text;
        if (p.text_color) l.barTextColor = p.text_color;
        if (p.font) {
          const f = parseFontString(p.font);
          l.barFontName = f.name; l.barFontSize = f.size;
          l.barFontRef = p.font; // точная строка шрифта из оригинала
        }
        if (p.bar_style) {
          const s = resolveSlicedPattern(p.bar_style, fileMap);
          if (s) { l.barStyleImg = s; cacheUrlsFromSlices(s); }
          l.barStylePattern = p.bar_style;
        }
        if (p.highlight_style) {
          const s = resolveSlicedPattern(p.highlight_style, fileMap);
          if (s) { l.highlightStyleImg = s; cacheUrlsFromSlices(s); }
          l.highlightStylePattern = p.highlight_style;
        }
        if (p.highlight_overlay) l.highlightOverlay = p.highlight_overlay === 'true';
        if (p.id === '__timeout__') l.useTimeoutId = true;
        l.name = defaultName(l);
        layers.push(l);
      }

      else if (block.type === 'circular_progress') {
        const cw = p.width !== undefined ? parseInt(p.width, 10) : 90;
        const ch = p.height !== undefined ? parseInt(p.height, 10) : 90;
        const l = makeLayer('circular', { x, y, w: cw, h: ch });
        if (p.id === '__timeout__') l.useTimeoutId = true;
        if (p.num_ticks) l.numTicks = parseInt(p.num_ticks, 10);
        if (p.start_angle) l.startAngle = parseInt(p.start_angle, 10);
        if (p.ticks_disappear) l.ticksDisappear = p.ticks_disappear === 'true';
        if (p.center_bitmap) { const u = lookupFile(fileMap, p.center_bitmap); if (u) { l.centerBitmap = u; cacheImage(u); } }
        if (p.tick_bitmap) { const u = lookupFile(fileMap, p.tick_bitmap); if (u) { l.tickBitmap = u; cacheImage(u); } }
        l.name = defaultName(l);
        layers.push(l);
      }

      else if (block.type === 'image') {
        const fileUrl = lookupFile(fileMap, p.file);
        // если width/height не заданы явно в theme.txt — считаем это авто-размером
        // (GRUB для + image без width/height берёт исходный размер картинки 1:1)
        const autoSize = p.width === undefined && p.height === undefined;
        const l = makeLayer('image', {
          x, y,
          w: p.width !== undefined ? coordToPx(p.width, newW) : 200,
          h: p.height !== undefined ? coordToPx(p.height, newH) : 200,
        });
        l.imgAutoSize = autoSize;
        if (fileUrl) {
          l.imgUrl = fileUrl;
          l.imgPattern = p.file;
          cacheImage(fileUrl, (img) => {
            if (l.imgAutoSize) { l.w = img.naturalWidth; l.h = img.naturalHeight; renderAll(); }
          });
        }
        l.name = 'Картинка' + (p.file ? ': ' + p.file : '');
        layers.push(l);
      }

      else if (block.type === '__os_icons__') {
        // служебный, не рендерим
      } else if (block.type === 'boot_menu' || block.type === 'canvas' || block.type === 'hbox' || block.type === 'vbox') {
        // контейнерные типы GRUB, не имеющие прямого аналога в редакторе —
        // сохраняем блок как есть, чтобы не потерять его при экспорте
        theme.unknownBlocks = theme.unknownBlocks || [];
        theme.unknownBlocks.push(block);
      }

      else {
        // любой незнакомый тип блока — сохраняем без изменений
        theme.unknownBlocks = theme.unknownBlocks || [];
        theme.unknownBlocks.push(block);
      }
    });

    if (osEntries.length === 0) autoCreateOsEntriesFromIcons(fileMap);
    // если сгенерировали больше чем строк в меню — ограничим itemCount, чтобы предпросмотр не резал лишнее
    if (osEntries.length > 0) {
      layers.filter(l => l.type === 'menu').forEach(l => {
        // подгоняем itemCount под реальное число записей (потолок 20 = предел поля инспектора)
        if (l.itemCount < Math.min(osEntries.length, 20)) l.itemCount = Math.min(osEntries.length, 20);
      });
    }
    resizeStage();
    renderAll();
    renderOsConfig();
  };

  if (bgUrl) {
    const probe = new Image();
    probe.onload = () => { newW = probe.naturalWidth; newH = probe.naturalHeight; finishImport(); };
    probe.onerror = finishImport;
    probe.src = bgUrl;
  } else {
    finishImport();
  }
}

/* ============================================================
   МЕНЮ «Файл»
   ============================================================ */

const fileInputHidden = document.createElement('input');
fileInputHidden.type = 'file';
fileInputHidden.accept = 'application/json';
fileInputHidden.style.display = 'none';
document.body.appendChild(fileInputHidden);
fileInputHidden.addEventListener('change', (e) => {
  const f = e.target.files[0]; if (f) openProjectFile(f);
});

const folderInputHidden = document.createElement('input');
folderInputHidden.type = 'file';
folderInputHidden.webkitdirectory = true;
folderInputHidden.style.display = 'none';
document.body.appendChild(folderInputHidden);
folderInputHidden.addEventListener('change', (e) => {
  if (e.target.files.length) importThemeFolder(e.target.files);
  folderInputHidden.value = '';
});

const archiveInputHidden = document.createElement('input');
archiveInputHidden.type = 'file';
archiveInputHidden.accept = '.zip,.tar,.gz,.tgz';
archiveInputHidden.style.display = 'none';
document.body.appendChild(archiveInputHidden);
archiveInputHidden.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) importThemeFromArchiveFile(f);
  archiveInputHidden.value = '';
});

function renderFileMenu() {
  const dd = document.getElementById('menu-file-dropdown');
  dd.innerHTML = `
    <div class="menu-row" data-file="new">Новый проект <span class="kbd">Shift+N</span></div>
    <div class="menu-row" data-file="open">Открыть проект… <span class="kbd">Shift+O</span></div>
    <div class="menu-row" data-file="save">Сохранить проект <span class="kbd">Shift+S</span></div>
    <div class="menu-sep"></div>
    <div class="menu-item" id="submenu-import" style="width:100%;">
      <div class="menu-row" id="submenu-import-btn">Импортировать тему GRUB ▸</div>
      <div class="menu-dropdown" id="submenu-import-dropdown" style="top:0;left:calc(100% + 2px);z-index:61;">
        <div class="menu-row" data-file="import-folder">Из папки…</div>
        <div class="menu-row" data-file="import-archive">Из архива (.zip / .tar / .tar.gz)…</div>
      </div>
    </div>
    <div class="menu-sep"></div>
    <div class="menu-row" data-file="export-theme">Экспорт theme.txt <span class="kbd">Ctrl+E</span></div>
    <div class="menu-row" data-file="export-zip">Экспорт ZIP (тема)</div>
    <div class="menu-row" data-file="export-png">Экспорт PNG <span class="kbd">Ctrl+P</span></div>
  `;
  dd.querySelectorAll('[data-file]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = item.getAttribute('data-file');
      document.getElementById('menu-file').classList.remove('open');
      document.getElementById('submenu-import').classList.remove('open');
      if (act === 'new') newProject();
      if (act === 'open') fileInputHidden.click();
      if (act === 'save') saveProjectFile();
      if (act === 'import-folder') folderInputHidden.click();
      if (act === 'import-archive') archiveInputHidden.click();
      if (act === 'export-theme') document.getElementById('btn-export').click();
      if (act === 'export-png') exportPng();
      if (act === 'export-zip') document.getElementById('btn-export-zip').click();
    });
  });
  const submenuBtn = document.getElementById('submenu-import-btn');
  submenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('submenu-import').classList.toggle('open');
  });
  // ховер — открываем, уход мыши — закрываем (hover в CSS уже, это для консистентности на тач)
  document.getElementById('submenu-import').addEventListener('mouseenter', () => {
    document.getElementById('submenu-import').classList.add('open');
  });
  document.getElementById('submenu-import').addEventListener('mouseleave', () => {
    document.getElementById('submenu-import').classList.remove('open');
  });
}
renderFileMenu();

document.getElementById('menu-file-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('menu-view').classList.remove('open');
  document.getElementById('menu-file').classList.toggle('open');
});

/* ============================================================
   ПАНЕЛИ: ресайз, скрытие, меню «Вид»
   ============================================================ */

const PANELS = [
  { id: 'inspector-wrap',      label: 'Панель свойств' },
  { id: 'canvas-wrap',         label: 'Холст' },
  { id: 'project-tree-wrap',   label: 'Дерево проекта' },
  { id: 'layers',              label: 'Слои' },
  { id: 'top-toolbar',         label: 'Панель вставки' },
];

const panelVisible = { 'inspector-wrap': true, 'canvas-wrap': true, 'project-tree-wrap': false, layers: true, 'right-wrap': true, 'top-toolbar': false };
function applyPanelVisibility() {
  const wrap = document.getElementById('inspector-wrap');
  if(wrap) wrap.style.display = panelVisible['inspector-wrap'] ? 'flex' : 'none';
  const sv = document.querySelector('.splitter-v[data-resize="inspector-wrap"]');
  if(sv) sv.style.display = panelVisible['inspector-wrap'] ? 'block' : 'none';
  const rightAny = panelVisible['project-tree-wrap'] || panelVisible.layers;
  document.getElementById('right-wrap').style.display = rightAny ? 'flex' : 'none';
  document.querySelector('.splitter-v[data-resize="right-wrap"]').style.display = rightAny ? 'block' : 'none';
  document.getElementById('project-tree-wrap').style.display = panelVisible['project-tree-wrap'] ? 'flex' : 'none';
  document.getElementById('layers').style.display = panelVisible.layers ? 'flex' : 'none';
  // Если «Проект» скрыт — «Слои» должны занимать ВСЮ колонку, иначе справа
  // остаётся недорендеренная пустота (панель была прибита к height:45%).
  const treeEl = document.getElementById('project-tree-wrap');
  const layersEl = document.getElementById('layers');
  if (panelVisible['project-tree-wrap'] && panelVisible.layers) {
    treeEl.style.flex = '1'; treeEl.style.height = 'auto';
    layersEl.style.flex = 'none'; // высоту задаёт inline height (45%)
  } else if (panelVisible['project-tree-wrap']) {
    treeEl.style.flex = '1'; treeEl.style.height = 'auto';
  } else if (panelVisible.layers) {
    layersEl.style.flex = '1'; layersEl.style.height = 'auto';
  }
  // горизонтальный сплиттер имеет смысл только когда видны ОБЕ панели над/под ним
  const hsp = document.querySelector('.splitter-h[data-resize="project-tree-wrap"]');
  if (hsp) hsp.style.display = (panelVisible['project-tree-wrap'] && panelVisible.layers) ? 'block' : 'none';
  const tb = document.getElementById('top-toolbar');
  if (tb) tb.style.display = panelVisible['top-toolbar'] ? 'flex' : 'none';
}

function renderViewMenu() {
  const dd = document.getElementById('menu-view-dropdown');
  dd.innerHTML = PANELS.map(p => `
    <div class="menu-check ${panelVisible[p.id] ? 'checked' : ''}" data-toggle="${p.id}">
      <span class="box">${panelVisible[p.id] ? '✓' : ''}</span>
      <span>${p.label}</span>
    </div>
  `).join('');
  dd.querySelectorAll('[data-toggle]').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-toggle');
      if (id === 'canvas-wrap') return;
      panelVisible[id] = !panelVisible[id];
      applyPanelVisibility();
      renderViewMenu();
    });
  });
}

document.getElementById('menu-view-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('menu-file').classList.remove('open');
  document.getElementById('menu-view').classList.toggle('open');
});
window.addEventListener('click', () => {
  document.getElementById('menu-view').classList.remove('open');
  document.getElementById('menu-file').classList.remove('open');
  const submenu = document.getElementById('submenu-import');
  if (submenu) submenu.classList.remove('open');
});

document.addEventListener('click', (e)=>{
  const x = e.target.closest('.close-x[data-panel]');
  if(!x) return;
  const id = x.getAttribute('data-panel');
  if(panelVisible[id]===undefined) return;
  panelVisible[id] = false;
  applyPanelVisibility();
  renderViewMenu();
});

/* ---------- drag-resize сплиттеров панелей ---------- */
let activeSplitter = null;
let splitStart = { x: 0, y: 0, sizeA: 0 };

document.querySelectorAll('.splitter-v, .splitter-h').forEach(sp => {
  sp.addEventListener('mousedown', (e) => {
    activeSplitter = sp;
    sp.classList.add('active');
    splitStart.x = e.clientX;
    splitStart.y = e.clientY;
    const targetId = sp.getAttribute('data-resize');
    const target = document.getElementById(targetId);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    splitStart.sizeA = sp.classList.contains('splitter-v') ? rect.width : rect.height;
    e.preventDefault();
  });
});

window.addEventListener('mousemove', (e) => {
  if (!activeSplitter) return;
  const targetId = activeSplitter.getAttribute('data-resize');
  const target = document.getElementById(targetId);
  if (!target) return;
  if (activeSplitter.classList.contains('splitter-v')) {
    const dx = e.clientX - splitStart.x;
    const isLeftPanel = targetId === 'inspector-wrap';
    const isRightPanel = targetId === 'right-wrap';
    const newW = isLeftPanel ? splitStart.sizeA + dx : (isRightPanel ? splitStart.sizeA - dx : splitStart.sizeA + dx);
    target.style.width = Math.max(160, newW) + 'px';
    target.style.flex = 'none';
  } else {
    const dy = e.clientY - splitStart.y;
    if (targetId === 'layers') {
      // инверт: тянем границу ВВЕРХ — layers должен расти, тянем вниз — уменьшаться
      // dy отрицательный при тяге вверх, значит вычитаем
      const newH = Math.max(80, splitStart.sizeA - dy);
      target.style.height = newH + 'px';
      target.style.flex = 'none';
    } else {
      const newH = splitStart.sizeA + dy;
      target.style.height = Math.max(60, newH) + 'px';
      target.style.flex = 'none';
      const sibling = document.getElementById('layers');
      if (sibling) { sibling.style.flex = '1'; sibling.style.height = 'auto'; }
    }
  }
});
window.addEventListener('mouseup', () => {
  if (activeSplitter) activeSplitter.classList.remove('active');
  activeSplitter = null;
});

renderViewMenu();
applyPanelVisibility();

/* ============================================================
   ГЛОБАЛЬНЫЙ РЕРЕНДЕР
   ============================================================ */

/* ---------- Project Tree (Construct-like) ---------- */
let projectFiles = {}; // {path: blobUrl}
let projectFonts = []; // [{name, file, url}] — .pf2 шрифты проекта: name = ТОЧНОЕ имя шрифта как его видит GRUB (family + weight + size), file = реальный путь .pf2 в архиве (никогда не переименовывается редактором)

// Читает бинарный заголовок PF2 (формат grub-mkfont) и достаёт настоящее имя шрифта.
// Секции идут как 4-байтный тег + 4-байтная BE-длина + данные. NAME обычно уже содержит
// готовую строку "Familia Стиль Размер" (например "JetBrains Mono Regular 20") — то самое,
// что нужно писать в theme.txt как item_font/title-font и т.п. Если по какой-то причине
// NAME отсутствует/непонятен — собираем вручную из FAMI+WEIG+SLAN+PTSZ.
async function readPf2FontName(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer()); // хедер всегда в начале файла
    const dv = new DataView(buf.buffer);
    const dec = new TextDecoder('utf-8');
    const tag4 = (off) => dec.decode(buf.subarray(off, off + 4));
    if (tag4(0) !== 'FILE' || tag4(8) !== 'PFF2') return null;
    let off = 12;
    const sections = {};
    while (off + 8 <= buf.length) {
      const tag = tag4(off);
      const len = dv.getUint32(off + 4, false); // big-endian
      const dataStart = off + 8;
      if (dataStart + len > buf.length) break; // хедер обрезан нашим срезом .slice(0,4096) — секция крупнее (напр. CHIX) — прекращаем, дальше не нужно
      if (tag === 'DATA') break; // после DATA начинаются глифы — секции с метаданными закончились
      sections[tag] = buf.subarray(dataStart, dataStart + len);
      off = dataStart + len;
    }
    const str = (tag) => sections[tag] ? dec.decode(sections[tag]).replace(/\0+$/, '') : null;
    const name = str('NAME');
    if (name) return name;
    const fami = str('FAMI'); const weig = str('WEIG'); const slan = str('SLAN'); const ptsz = sections['PTSZ'];
    if (fami) {
      const weight = weig && /bold/i.test(weig) ? 'Bold' : 'Regular';
      const slant = slan && /italic/i.test(slan) ? 'Italic' : '';
      const size = ptsz ? new DataView(ptsz.buffer, ptsz.byteOffset, ptsz.byteLength).getUint16(0, false) : null;
      return `${fami} ${weight}${slant ? ' ' + slant : ''}${size ? ' ' + size : ''}`.trim();
    }
    return null;
  } catch { return null; }
}
// Фолбэк, когда бинарник не читается (повреждён/не .pf2) — угадываем по имени файла как раньше.
function guessFontNameFromFileName(fname) {
  const base = fname.replace(/\.pf2$/i, '');
  const m = base.match(/^(.*?)[-_](bold|regular|italic|bolditalic)[-_](\d+)$/i);
  if (m) {
    const fam = m[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const style = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    return `${fam} ${style} ${m[3]}`;
  }
  // "JetBrainsMono_20" (реальное соглашение многих тем: имя без разделителей + _РАЗМЕР, без слова стиля)
  const m2 = base.match(/^([A-Za-z]+)[-_](\d+)$/);
  if (m2) return `${m2[1].replace(/([a-z])([A-Z])/g, '$1 $2')} Regular ${m2[2]}`;
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Regular 16';
}
// Единая точка добавления шрифта в проект — используется и деревом проекта, и инспектором меню.
// Всегда сохраняет ОРИГИНАЛЬНОЕ имя файла (font/<как есть>.pf2) — так экспорт совпадает 1:1
// с тем, что реально лежит в архиве, без придуманного редактором соглашения именования.
async function addProjectFont(file, onDone) {
  const url = URL.createObjectURL(file);
  let fontName = await readPf2FontName(file);
  if (!fontName) fontName = guessFontNameFromFileName(file.name);
  const entry = { name: fontName, file: 'font/' + file.name, url, realFile: true };
  projectFonts.push(entry);
  if (onDone) onDone(entry);
  return entry;
}
function grubFontToFile(fontStr) {
  // "Sans Bold 28" -> "sans-bold-28.pf2" (соглашение редактора для авто-сборки шрифтов)
  if (!fontStr) return null;
  const m = String(fontStr).trim().match(/^(.*?)\s+(Bold|Regular|Italic|BoldItalic)\s+(\d+)$/i);
  if (!m) return String(fontStr).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pf2';
  return `${m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${m[2].toLowerCase()}-${m[3]}.pf2`;
}
function projectFontFiles() {
  // все реально используемые строки шрифта (item_font/title-font/font и т.п. — с приоритетом
  // на точные *Ref строки, сохранённые при импорте) -> соответствующий .pf2 файл.
  // Сперва ищем среди РЕАЛЬНО загруженных шрифтов (projectFonts, включая распакованные
  // из архива при импорте) — это и есть настоящее соответствие имя-файл. Если для строки
  // нет загруженного файла (пользователь создаёт тему с нуля и ещё не приложил .pf2) —
  // синтезируем ожидаемое имя по старому соглашению редактора, просто как подсказку.
  const used = new Set();
  if (theme.titleVisible && theme.titleText) used.add(theme.titleFont);
  if (theme.terminalVisible && theme.terminalFont) used.add(theme.terminalFont);
  layers.forEach(l => {
    // ВАЖНО: сам экспорт theme.txt (сборка блоков) пропускает невидимые слои
    // (if (!l.visible) return;) — их свойства вообще не попадают в файл. Раньше здесь
    // этой проверки не было, и редактор мог требовать/предупреждать про шрифт слоя,
    // которого в экспортированной теме нет вовсе (например, временно скрытый лейбл).
    if (!l.visible) return;
    if (l.type === 'menu') {
      used.add(l.itemFontRef || `${l.fontName || 'DejaVu Sans Mono'} Regular ${l.fontSize}`);
      if (l.hasSeparateSelectedFont) {
        used.add(l.selectedItemFontRef || `${l.fontName || 'DejaVu Sans Mono'} Bold ${l.selectedFontSize || l.fontSize}`);
      } else if (l.selectedFontSize) {
        used.add(`${l.fontName || 'DejaVu Sans Mono'} Bold ${l.selectedFontSize}`);
      }
    } else if (l.type === 'label') {
      used.add(l.fontRef || `${l.fontName || 'DejaVu Sans Mono'} ${l.fontBold ? 'Bold' : 'Regular'} ${l.fontSize}`);
    } else if (l.type === 'progress' && l.showBarText) {
      used.add(l.barFontRef || `${l.barFontName || l.fontName || 'DejaVu Sans Mono'} Regular ${l.barFontSize || 16}`);
    }
  });
  return [...used].filter(Boolean).map(f => {
    // реально загруженный файл для точно этой строки шрифта — используем его путь как есть
    const real = projectFonts.find(pf => pf.name === f);
    return { font: f, file: real ? real.file : 'font/' + grubFontToFile(f), missing: !real };
  });
}
let projectTreeCollapsed = new Set();
function bindTreeFontUpload(rootEl) {
  // кнопка "+ Шрифт .pf2" в дереве проекта (рабочее дерево) — читает реальное имя из .pf2,
  // сохраняет реальный путь файла (без переименования по своему соглашению)
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--border);';
  bar.innerHTML = `<button data-tree-font-add style="flex:1;padding:5px 8px;">+ Шрифт .pf2</button>
    <input type="file" data-tree-font-file accept=".pf2" hidden>`;
  rootEl.appendChild(bar);
  const inp = bar.querySelector('[data-tree-font-file]');
  bar.querySelector('[data-tree-font-add]').addEventListener('click', () => inp.click());
  inp.addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    await addProjectFont(f);
    renderProjectTree();
  });
}
function renderProjectTree() {
  const root = document.getElementById('project-tree');
  const q = (document.getElementById('project-tree-search')?.value || '').toLowerCase();
  if (!root) return;
  const allPaths = Object.keys(projectFiles);
  const typeIcon = (type)=>{
    const m={menu:'☰',progress:'▬',circular:'◐',label:'T',box:'▢',image:'🖼'};
    return m[type]||'•';
  };
  // пустой проект — показываем древо из Слои + ОС
  if (allPaths.length === 0) {
    const lay = q ? layers.filter(l=> (l.name||'').toLowerCase().includes(q) || l.type.toLowerCase().includes(q)) : layers;
    const os  = q ? osEntries.filter(e=> e.name.toLowerCase().includes(q)) : osEntries;
    const sel = selectedId;
    const layerIcon = (t)=> ({menu:'≡',progress:'▭',circular:'◎',label:'T',box:'⬚',image:'🖼',unknown:'•'}[t]||'•');
    let html='';
    html+=`<div class="tree-section">СЛОИ (${lay.length})</div>`;
    if(lay.length) lay.forEach(l=>{
      const act = l.id===sel?' active':'';
      html+=`<div class="tree-item${act}" data-layer="${l.id}"><span class="ico">${layerIcon(l.type)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(l.name)}</span></div>`;
    }); else html+=`<div class="tree-item" style="color:var(--text-2);">— пусто</div>`;
    html+=`<div class="tree-section">ОС ЗАПИСИ (${os.length})</div>`;
    if(os.length) os.forEach(e=>{
      html+=`<div class="tree-item" data-os="${e.id}"><span class="ico">💿</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.name)}</span></div>`;
    }); else html+=`<div class="tree-item" style="color:var(--text-2);">— пусто</div>`;
    html+=`<div class="tree-item" style="color:var(--text-2);margin-top:6px;font-size:10px;">Импортируй тему через Файл → Импорт…</div>`;
    root.innerHTML=html;
    bindTreeFontUpload(root);
    root.querySelectorAll('[data-layer]').forEach(el=>{
      el.addEventListener('click',()=>{ selectedId=Number(el.getAttribute('data-layer')); renderAll(); });
    });
    return;
  }
  // строим файловое дерево: projectFiles (импорт) + projectFonts (загруженные .pf2)
  const tree = {};
  const allEntries = [...allPaths];
  for (const f of projectFonts) { if (!allEntries.includes(f.file)) allEntries.push(f.file); }
  for (const { file } of projectFontFiles()) { if (!allEntries.includes(file)) allEntries.push(file); }
  allEntries.forEach(p => {
    const parts = p.split('/');
    let cur = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) cur[part] = { __file: true, __path: p };
      else { cur[part] = cur[part] || {}; cur = cur[part]; }
    });
  });
  const extIcon = (name) => {
    const ext = name.split('.').pop().toLowerCase();
    if (['png','jpg','jpeg','webp','bmp','svg'].includes(ext)) return '🖼';
    if (ext === 'pf2') return '🔤';
    if (ext === 'txt') return '📄';
    if (ext === 'cfg') return '⚙';
    return '📄';
  };
  const renderNode = (node, prefix, depth) => {
    let html = '';
    const entries = Object.entries(node).sort((a,b) => {
      const aIsFile = !!a[1].__file, bIsFile = !!b[1].__file;
      if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
      return a[0].localeCompare(b[0]);
    });
    entries.forEach(([name, val]) => {
      if (val.__file) {
        const full = val.__path;
        if (q && !full.toLowerCase().includes(q)) return;
        const icon = extIcon(name);
        html += `<div class="tree-item proj-file" data-path="${escapeHtml(full)}" style="margin-left:${depth?12:0}px;"><span class="ico">${icon}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</span></div>`;
      } else {
        const fullPath = prefix ? prefix + '/' + name : name;
        const collapsed = projectTreeCollapsed.has(fullPath);
        const count = Object.keys(projectFiles).filter(k => k.startsWith(fullPath + '/')).length;
        if (q && !Object.keys(projectFiles).some(k => k.startsWith(fullPath + '/') && k.toLowerCase().includes(q)) && !name.toLowerCase().includes(q)) return;
        html += `<div class="tree-item tree-folder proj-folder ${collapsed?'collapsed':''}" data-folder="${escapeHtml(fullPath)}"><span class="exp ${collapsed?'collapsed':''}">▾</span><span class="ico">📁</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</span><span style="color:var(--text-2);font-size:10px;">${count}</span></div>`;
        if (!collapsed) html += `<div class="tree-branch">${renderNode(val, fullPath, depth + 1)}</div>`;
      }
    });
    return html;
  };
  root.innerHTML = renderNode(tree, '', 0) || '<div style="color:var(--text-2);padding:6px;">Нет файлов</div>';
  bindTreeFontUpload(root);
  root.querySelectorAll('.proj-folder').forEach(el => {
    el.addEventListener('click', () => {
      const f = el.getAttribute('data-folder');
      if (projectTreeCollapsed.has(f)) projectTreeCollapsed.delete(f); else projectTreeCollapsed.add(f);
      renderProjectTree();
    });
  });
  root.querySelectorAll('.proj-file').forEach(el => {
    el.addEventListener('click', () => {
      const p = el.getAttribute('data-path');
      const layer = layers.find(l => (l.imgPattern && p.includes(l.imgPattern.replace('*.png',''))) || (l.menuBorderPattern && p.includes(l.menuBorderPattern.replace('*.png',''))));
      if (layer) { selectedId = layer.id; renderAll(); }
      const url = projectFiles[p];
      if (url && /\.(png|jpe?g|webp|bmp|svg)$/i.test(p)) {
        const w = window.open('', '_blank');
        if (w) w.document.write(`<body style="margin:0;background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:95vw;max-height:95vh;box-shadow:0 8px 40px rgba(0,0,0,0.6)"><div style="position:fixed;top:8px;left:8px;color:#aaa;font:12px monospace;background:rgba(0,0,0,0.6);padding:4px 8px;border-radius:4px;">${escapeHtml(p)}</div></body>`);
      }
    });
  });
}
document.getElementById('project-tree-search')?.addEventListener('input', renderProjectTree);

function renderAll() {
  drawEditor();
  renderLayerList();
  renderProjectTree();
  // Не пересоздаём инспектор если фокус внутри него — иначе слетает ввод текста/color picker
  const ae = document.activeElement;
  const insideInspector = ae && ae.closest && ae.closest('#inspector-body');
  if (!insideInspector) renderInspector();
  else if (!getLayer(selectedId)) renderInspectorOsSection(); // секция иконок ОС зависит от osEntries — обновляем точечно
  // при выбранном слое список иконок ОС живёт в нижней панели — обновляем её тоже
  // (кроме случая когда фокус внутри неё — не теряем ввод)
  applyPanelVisibility();
  updateMenuAddDisabled();
}
function updateMenuAddDisabled(){
  const hasMenu = !!getMenuLayer();
  const tbBtn = document.getElementById('tb-add-menu');
  if(tbBtn) tbBtn.disabled = hasMenu;
  const bBtn = document.getElementById('btn-add-menu');
  if(bBtn) bBtn.disabled = hasMenu;
  const ctxAdd = document.querySelector('#ctx-add-actions .menu-row[data-add=\"menu\"]');
  if(ctxAdd) ctxAdd.classList.toggle('disabled', hasMenu);
  const ctxDup = document.querySelector('#ctx-menu .menu-row[data-ctx=\"duplicate\"]');
  if(ctxDup && ctxMenuLayerId){
    const hit = getLayer(ctxMenuLayerId);
    ctxDup.classList.toggle('disabled', !!(hit && hit.type==='menu'));
  } else if(ctxDup) ctxDup.classList.remove('disabled');
}

// GRUB-точное превью — моноширинный, целые %, без скруглений и без рамок выбора.
// Таймер: берётся из текста "%d сек" (как set timeout в grub.cfg), иначе 10с.
// Любая клавиша (кроме Esc) останавливает отсчёт и прячет __timeout__ — как GRUB.
let previewSecs = 10;
function previewTimeoutTotal() {
  // приоритет — поле timeout в шапке превью (как set timeout в grub.cfg),
  // иначе ищем "%d сек" в текстах, иначе 10с
  try {
    const inp = document.getElementById('preview-timeout');
    if (inp && inp.value !== '' && Number(inp.value) > 0) {
      return Math.max(1, Math.min(120, parseInt(inp.value, 10)));
    }
  } catch {}
  try {
    const joined = layers.filter(l => l.type === 'label').map(l => (l.text || '')).join(' ');
    const m = joined.match(/(\d+)\s*сек/i);
    if (m) return Math.max(3, Math.min(60, parseInt(m[1], 10)));
  } catch {}
  return 10;
}
function previewSubstVars(text, secs) {
  return String(text || '')
    .replace(/@TIMEOUT_NOTIFICATION_SHORT@/g, `Boot in ${secs}s`)
    .replace(/@TIMEOUT_NOTIFICATION_MIDDLE@/g, `The highlighted entry will be executed in ${secs} seconds`)
    .replace(/@TIMEOUT_NOTIFICATION_LONG@/g, `The highlighted entry will be executed in ${secs} seconds`)
    .replace(/@KEYMAP_SHORT@/g, 'en')
    .replace(/@KEYMAP_MIDDLE@/g, 'English keyboard')
    .replace(/@KEYMAP_LONG@/g, 'English (US) keyboard layout')
    .replace(/%d/g, String(secs));
}
function closePreview() {
  ctx = _previewSaved.ctx; canvas = _previewSaved.canvas;
  scale = _previewSaved.scale; selectedId = _previewSaved.selectedId;
  if (window.__previewTimer) { clearInterval(window.__previewTimer); window.__previewTimer = null; }
  if (window.__previewKeyHandler) { document.removeEventListener('keydown', window.__previewKeyHandler); window.__previewKeyHandler = null; }
  document.getElementById('preview-bg').style.display = 'none';
}
let _previewSaved = null;
function openPreview() {
  const pc = document.getElementById('preview-canvas');
  const bg = document.getElementById('preview-bg');
  const info = document.getElementById('preview-info');
  if (!pc || !bg) return;
  if (window.__previewTimer) { clearInterval(window.__previewTimer); window.__previewTimer = null; }
  if (window.__previewKeyHandler) { document.removeEventListener('keydown', window.__previewKeyHandler); window.__previewKeyHandler = null; }
  previewSecs = previewTimeoutTotal();
  try {
    const inp = document.getElementById('preview-timeout');
    if (inp) {
      inp.value = previewSecs;
      inp.onchange = () => {
        if (document.getElementById('preview-bg').style.display !== 'flex') return;
        previewSecs = previewTimeoutTotal();
        totalSecs = previewSecs; remainSecs = previewSecs; grubTimedOut = false;
        if (window.__previewTimer) { clearInterval(window.__previewTimer); window.__previewTimer = null; }
        renderFrame();
        info.textContent = `${STAGE_W}×${STAGE_H} · таймер ${totalSecs}с · любая клавиша = стоп (как GRUB)`;
        window.__previewTimer = setInterval(() => {
          if (document.getElementById('preview-bg').style.display !== 'flex') {
            clearInterval(window.__previewTimer); window.__previewTimer = null; return;
          }
          if (remainSecs > 0) { remainSecs--; renderFrame(); }
          else { clearInterval(window.__previewTimer); window.__previewTimer = null; }
        }, 1000);
      };
    }
  } catch {}
  let totalSecs = previewSecs;
  let remainSecs = totalSecs;
  let grubTimedOut = false;
  // размер превью = реальный STAGE_W×H, но вмещаем в модалку с сохранением пропорций
  const maxW = Math.min(900, window.innerWidth - 80);
  const maxH = Math.min(660, window.innerHeight - 140);
  const s = Math.min(maxW / STAGE_W, maxH / STAGE_H, 1);
  pc.width = STAGE_W; pc.height = STAGE_H;
  pc.style.width = Math.round(STAGE_W * s) + 'px';
  pc.style.height = Math.round(STAGE_H * s) + 'px';
  const pctx = pc.getContext('2d');
  // рендерим без рамок выбора
  _previewSaved = { ctx, canvas, scale, selectedId };
  selectedId = null;
  // временно подменяем globals для отрисовки в pctx
  // хак: drawLayerShape использует глобальный ctx/canvas/scale — подменяем
  ctx = pctx; canvas = pc; scale = 1;

  function substTimeoutVars(text, secs) {
    return previewSubstVars(text, secs);
  }
  function renderFrame() {
    // фон
    pctx.clearRect(0,0,pc.width, pc.height);
    drawThemeBackground(pctx, bgImage, pc.width, pc.height, theme.bgScaleMethod, theme.bgHAlign, theme.bgVAlign, bgColor);
    // title
    if (theme.titleVisible && theme.titleText) {
      const tParts = String(theme.titleFont || 'DejaVu Sans Mono Bold 28').match(/^(.*?)\s+(Bold|Regular|Italic|BoldItalic)\s+(\d+)$/i);
      const tFontName = tParts ? tParts[1] : 'DejaVu Sans Mono';
      const tSize = tParts ? parseInt(tParts[3], 10) : 28;
      const tBold = tParts ? /bold/i.test(tParts[2]) : true;
      pctx.fillStyle = theme.titleColor;
      pctx.font = `${tBold ? '600 ' : ''}${tSize}px ${fontStackFor(tFontName)}`;
      pctx.textAlign='center'; pctx.fillText(theme.titleText, pc.width/2, 24); pctx.textAlign='left';
    }
    layers.forEach(l=>{
      if(!l.visible) return;
      if (grubTimedOut && l.useTimeoutId) return; // GRUB прячет __timeout__ после нажатия клавиши
      if (l.type === 'label' && l.useTimeoutId) {
        const keep = l.text;
        l.text = substTimeoutVars(keep, remainSecs);
        drawLayerShape(pctx, l, 1);
        l.text = keep;
      } else if (l.type === 'progress' && l.useTimeoutId) {
        const keep = l.barText;
        // GRUB gui_progress_bar.c: barwidth = width * (value - start) / (end - start).
        // value — ПРОШЕДШЕЕ время, т.е. заливка РАСТЁТ от 0 до полной ширины.
        l._previewFrac = 1 - remainSecs / totalSecs;
        if (l.showBarText) l.barText = substTimeoutVars(keep, remainSecs);
        drawLayerShape(pctx, l, 1);
        l._previewFrac = null;
        l.barText = keep;
      } else if (l.type === 'circular' && l.useTimeoutId) {
        // GRUB gui_circular_progress.c: ticks_shown = ticks_disappear ? end-value : value-start.
        // value — прошедшее время: по умолчанию тики ПОЯВЛЯЮТСЯ, при ticks_disappear — исчезают.
        const keepTicks = l.numTicks;
        l._previewShown = l.ticksDisappear ? (remainSecs / totalSecs) : (1 - remainSecs / totalSecs);
        drawLayerShape(pctx, l, 1);
        l._previewShown = null;
      } else {
        drawLayerShape(pctx, l, 1);
      }
    });
  }
  renderFrame();
  info.textContent = `${STAGE_W}×${STAGE_H} · таймер ${totalSecs}с · любая клавиша = стоп (как GRUB)`;
  bg.style.display='flex';
  window.__previewTimer = setInterval(() => {
    if (document.getElementById('preview-bg').style.display !== 'flex') {
      clearInterval(window.__previewTimer); window.__previewTimer = null; return;
    }
    if (remainSecs > 0) { remainSecs--; renderFrame(); }
    else { clearInterval(window.__previewTimer); window.__previewTimer = null; }
  }, 1000);
  window.__previewKeyHandler = (e) => {
    if (document.getElementById('preview-bg').style.display !== 'flex') return;
    if (e.key === 'Escape') return;
    grubTimedOut = true;
    if (window.__previewTimer) { clearInterval(window.__previewTimer); window.__previewTimer = null; }
    renderFrame();
    info.textContent = `${STAGE_W}×${STAGE_H} · отсчёт остановлен клавишей (как GRUB)`;
  };
  document.addEventListener('keydown', window.__previewKeyHandler);
}
window.openPreview = openPreview;
window.closePreview = closePreview;

/* ---------- стартовая сцена ---------- */
resizeStage();
addLayer('label');
getLayer(selectedId).text = 'Выберите систему';
getLayer(selectedId).x = 160; getLayer(selectedId).y = 180;
addLayer('menu');
addLayer('progress');
selectedId = null;
renderAll();
renderOsConfig();