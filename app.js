(() => {
  'use strict';

  const SIZE = 64;              // размер текстуры скина
  const PREVIEW_SCALE = 8;      // пикселей на один «блок» в предпросмотре
  const MAX_HISTORY = 80;       // глубина отмены

  const PALETTE = [
    '#000000', '#ffffff', '#7f7f7f', '#c0c0c0', '#3f2a14', '#8b5a2b', '#e0b48a', '#f1c27d',
    '#ff5555', '#ff8800', '#ffd700', '#ffff55', '#55ff55', '#00aa00', '#2e7d32', '#00aaaa',
    '#55ffff', '#3b82f6', '#1e3a8a', '#5555ff', '#aa00aa', '#ff55ff', '#ff69b4', '#6b4f2a',
    '#3d2b1f', '#2d2d2d', '#4a4a4a', '#f5deb3', '#ffcc99', '#8fbc8f', '#4b0082', '#dc143c'
  ];

  const $ = id => document.getElementById(id);

  // ---------- Элементы ----------
  const canvas       = $('skin');
  const ctx          = canvas.getContext('2d', { willReadFrequently: true });
  const wrap         = $('canvasWrap');
  const box          = $('canvasBox');
  const gridEl       = $('grid');
  const coordsEl     = $('coords');
  const zoomInput    = $('zoom');
  const colorInput   = $('color');
  const hexInput     = $('hex');
  const paletteEl    = $('palette');
  const recentEl     = $('recent');
  const previewCanvas = $('preview');
  const pctx         = previewCanvas.getContext('2d');
  const showOverlay  = $('showOverlay');
  const showGrid     = $('showGrid');
  const undoBtn      = $('undo');
  const redoBtn      = $('redo');
  const fileInput    = $('fileInput');
  const toastEl      = $('toast');

  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.imageSmoothingEnabled = false;

  // ---------- Состояние ----------
  const state = { tool: 'pencil', color: '#3b82f6', zoom: 10, recent: [] };
  const history = { undo: [], redo: [] };
  let drawing = false;
  let strokeErase = false;
  let lastPt = null;
  let toastTimer = null;

  // ---------- Цвета ----------
  function hexToRgba(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function normalizeHex(value) {
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }

  function setColor(hex, remember = false) {
    state.color = hex;
    colorInput.value = hex;
    hexInput.value = hex.toUpperCase();
    if (remember) addRecent(hex);
  }

  function addRecent(hex) {
    state.recent = [hex, ...state.recent.filter(c => c !== hex)].slice(0, 8);
    renderSwatches(recentEl, state.recent);
  }

  function renderSwatches(container, colors) {
    container.innerHTML = '';
    colors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.title = c.toUpperCase();
      b.addEventListener('click', () => setColor(c, true));
      container.appendChild(b);
    });
  }

  colorInput.addEventListener('input', e => setColor(e.target.value));
  colorInput.addEventListener('change', e => setColor(e.target.value, true));
  hexInput.addEventListener('change', e => {
    const hex = normalizeHex(e.target.value);
    if (hex) setColor(hex, true);
    else {
      hexInput.value = state.color.toUpperCase();
      toast('Неверный HEX-код');
    }
  });

  // ---------- Инструменты ----------
  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool));
    canvas.style.cursor = tool === 'picker' ? 'copy' : tool === 'bucket' ? 'cell' : 'crosshair';
  }

  document.querySelectorAll('.tool[data-tool]').forEach(b =>
    b.addEventListener('click', () => setTool(b.dataset.tool)));

  // ---------- Рисование ----------
  function toPixel(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * SIZE);
    const y = Math.floor((e.clientY - r.top) / r.height * SIZE);
    return { x, y, inside: x >= 0 && y >= 0 && x < SIZE && y < SIZE };
  }

  function paint(x, y, erase) {
    if (erase) {
      ctx.clearRect(x, y, 1, 1);
    } else {
      ctx.fillStyle = state.color;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Линия Брезенхема: сплошные штрихи без пропусков при быстром движении мыши
  function line(x0, y0, x1, y1, fn) {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function floodFill(sx, sy, fill) {
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = img.data;
    const idx = (x, y) => (y * SIZE + x) * 4;
    const i0 = idx(sx, sy);
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
    const [fr, fg, fb, fa] = fill;
    if (tr === fr && tg === fg && tb === fb && ta === fa) return false;

    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const i = idx(x, y);
      if (d[i] !== tr || d[i + 1] !== tg || d[i + 2] !== tb || d[i + 3] !== ta) continue;
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  function pickColor(x, y) {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    if (a === 0) return toast('Здесь прозрачный пиксель');
    setColor(rgbToHex(r, g, b), true);
    setTool('pencil');
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 2) return;
    const p = toPixel(e);
    if (!p.inside) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    // Правая кнопка мыши — временный ластик
    const tool = e.button === 2 ? 'eraser' : state.tool;

    if (tool === 'picker') return pickColor(p.x, p.y);

    pushHistory();

    if (tool === 'bucket') {
      if (!floodFill(p.x, p.y, hexToRgba(state.color))) history.undo.pop();
      return afterChange();
    }

    drawing = true;
    strokeErase = tool === 'eraser';
    lastPt = p;
    paint(p.x, p.y, strokeErase);
    afterChange();
  });

  canvas.addEventListener('pointermove', e => {
    const p = toPixel(e);
    coordsEl.textContent = p.inside ? `X ${p.x}   Y ${p.y}` : '—';
    if (!drawing || !p.inside) return;
    line(lastPt.x, lastPt.y, p.x, p.y, (x, y) => paint(x, y, strokeErase));
    lastPt = p;
    renderPreview();
  });

  canvas.addEventListener('pointerleave', () => { coordsEl.textContent = '—'; });

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    lastPt = null;
    renderPreview();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // ---------- История (отмена / повтор) ----------
  function snapshot() {
    return ctx.getImageData(0, 0, SIZE, SIZE);
  }

  function pushHistory() {
    history.undo.push(snapshot());
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo.length = 0;
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    ctx.putImageData(history.undo.pop(), 0, 0);
    afterChange();
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    ctx.putImageData(history.redo.pop(), 0, 0);
    afterChange();
  }

  function afterChange() {
    undoBtn.disabled = !history.undo.length;
    redoBtn.disabled = !history.redo.length;
    renderPreview();
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  $('clear').addEventListener('click', () => {
    if (!confirm('Очистить всю текстуру?')) return;
    pushHistory();
    ctx.clearRect(0, 0, SIZE, SIZE);
    afterChange();
    toast('Текстура очищена');
  });

  // ---------- Масштаб и сетка ----------
  function applyZoom(z) {
    state.zoom = z;
    const px = SIZE * z;
    box.style.width = px + 'px';
    box.style.height = px + 'px';
    gridEl.style.setProperty('--cell', z + 'px');
  }

  zoomInput.addEventListener('input', e => applyZoom(Number(e.target.value)));
  showGrid.addEventListener('change', e => gridEl.classList.toggle('hidden', !e.target.checked));

  // ---------- Предпросмотр персонажа ----------
  // Координаты в единицах скина: [sx, sy, sw, sh, dx, dy, dw, dh]
  const BASE_PARTS = [
    [8, 8, 8, 8, 4, 0, 8, 8],       // голова
    [20, 20, 8, 12, 4, 8, 8, 12],   // тело
    [44, 20, 4, 12, 0, 8, 4, 12],   // правая рука
    [36, 52, 4, 12, 12, 8, 4, 12],  // левая рука
    [4, 20, 4, 12, 4, 20, 4, 12],   // правая нога
    [20, 52, 4, 12, 8, 20, 4, 12]   // левая нога
  ];

  const OVERLAY_PARTS = [
    [40, 8, 8, 8, 4, 0, 8, 8],
    [20, 36, 8, 12, 4, 8, 8, 12],
    [44, 36, 4, 12, 0, 8, 4, 12],
    [52, 52, 4, 12, 12, 8, 4, 12],
    [4, 36, 4, 12, 4, 20, 4, 12],
    [4, 52, 4, 12, 8, 20, 4, 12]
  ];

  function renderPreview() {
    const P = PREVIEW_SCALE;
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pctx.imageSmoothingEnabled = false;
    const draw = parts => parts.forEach(([sx, sy, sw, sh, dx, dy, dw, dh]) =>
      pctx.drawImage(canvas, sx, sy, sw, sh, dx * P, dy * P, dw * P, dh * P));
    draw(BASE_PARTS);
    if (showOverlay.checked) draw(OVERLAY_PARTS);
  }

  showOverlay.addEventListener('change', renderPreview);

  // ---------- Открытие и сохранение ----------
  // Копирует блок с горизонтальным отражением (для старых скинов 64×32)
  function flipCopy(sx, sy, w, h, dx, dy) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const t = tmp.getContext('2d');
    t.translate(w, 0);
    t.scale(-1, 1);
    t.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
    ctx.clearRect(dx, dy, w, h);
    ctx.drawImage(tmp, dx, dy);
  }

  function loadFile(file) {
    if (!file) return;
    if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) {
      return toast('Нужен файл PNG');
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
        return toast(`Неверный размер ${img.width}×${img.height}. Нужен 64×64 или 64×32`);
      }
      pushHistory();
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0);
      if (img.height === 32) {
        // Старый формат: ноги и руки левой стороны достраиваются из правых
        flipCopy(0, 16, 16, 16, 16, 48);
        flipCopy(40, 16, 16, 16, 32, 48);
      }
      afterChange();
      toast('Скин открыт');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('Не удалось открыть файл');
    };
    img.src = url;
  }

  function saveSkin() {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'skin.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Скин сохранён');
    }, 'image/png');
  }

  fileInput.addEventListener('change', e => {
    loadFile(e.target.files[0]);
    e.target.value = '';
  });
  $('btnSave').addEventListener('click', saveSkin);

  // Перетаскивание PNG прямо на рабочую область
  wrap.addEventListener('dragover', e => e.preventDefault());
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  // ---------- Горячие клавиши ----------
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const key = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      if (key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (key === 'y') { e.preventDefault(); redo(); }
      else if (key === 's') { e.preventDefault(); saveSkin(); }
      else if (key === 'o') { e.preventDefault(); fileInput.click(); }
      return;
    }

    const map = { p: 'pencil', e: 'eraser', f: 'bucket', i: 'picker' };
    if (map[key]) setTool(map[key]);
  });

  // ---------- Уведомления ----------
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------- Старт ----------
  previewCanvas.width = 16 * PREVIEW_SCALE;
  previewCanvas.height = 32 * PREVIEW_SCALE;
  applyZoom(state.zoom);
  setColor(state.color);
  renderSwatches(paletteEl, PALETTE);
  setTool('pencil');
  afterChange();
})();
