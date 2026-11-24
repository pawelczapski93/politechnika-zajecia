/* Basic Mechanical Engineering – shared lecture runtime.
   Canvas helpers, sliders, plots, navigation, quick-check quizzes, lecturer notes.
   No dependencies, works offline (open the .html file directly in a browser). */
(function () {
  'use strict';
  const BME = (window.BME = {});
  const root = document.documentElement;

  BME.LECTURES = [
    { n: 1, file: 'lecture01.html', title: 'Statics of a particle and of a rigid body' },
    { n: 2, file: 'lecture02.html', title: 'Distributed forces, centroids, structures and friction' },
    { n: 3, file: 'lecture03.html', title: 'Kinematics of a particle' },
    { n: 4, file: 'lecture04.html', title: 'Plane motion of a rigid body' },
    { n: 5, file: 'lecture05.html', title: 'Dynamics of a particle: Newton’s laws and momentum' },
    { n: 6, file: 'lecture06.html', title: 'Systems of particles and rigid-body kinetics' },
    { n: 7, file: 'lecture07.html', title: 'Axial loading: stress, strain and the tensile test' },
    { n: 8, file: 'lecture08.html', title: 'Shear, joints and stress analysis' },
    { n: 9, file: 'lecture09.html', title: 'Bending of beams' },
    { n: 10, file: 'lecture10.html', title: 'Torsion and power transmission' }
  ];

  /* ---------- small utilities ---------- */
  BME.c = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  BME.deg = Math.PI / 180;
  BME.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  BME.lerp = (a, b, t) => a + (b - a) * t;
  BME.fmt = function (v, d) {
    if (d === undefined) d = 2;
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a < 1e-9) return (0).toFixed(d);
    if (a >= 1e6 || a < 1e-3) return v.toExponential(2);
    const s = v.toFixed(d);
    return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
  };
  const decimalsOf = (step) => {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  };

  /* ---------- canvas ---------- */
  const canvases = [];
  BME.canvas = function (id, draw, opts) {
    opts = opts || {};
    const cv = typeof id === 'string' ? document.getElementById(id) : id;
    const ctx = cv.getContext('2d');
    const aspect = opts.aspect || parseFloat(cv.dataset.aspect) || 0.6;
    const minH = opts.minH || 240, maxH = opts.maxH || 580;
    const o = { cv, ctx, w: 0, h: 0, dpr: 1, draw };
    o.redraw = function () {
      if (!o.w) return;
      ctx.save();
      ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
      ctx.clearRect(0, 0, o.w, o.h);
      ctx.lineJoin = 'round';
      draw(ctx, o.w, o.h, o);
      ctx.restore();
    };
    o.resize = function () {
      const w = cv.clientWidth;
      const d = window.devicePixelRatio || 1;
      if (!w || (w === o.w && d === o.dpr)) return;
      const h = Math.round(BME.clamp(w * aspect, minH, maxH));
      o.dpr = d;
      cv.style.height = h + 'px';
      cv.width = Math.round(w * d);
      cv.height = Math.round(h * d);
      o.w = w; o.h = h;
      o.redraw();
    };
    new ResizeObserver(() => o.resize()).observe(cv);
    canvases.push(o);
    requestAnimationFrame(o.resize);
    return o;
  };
  BME.redrawAll = () => canvases.forEach((o) => o.redraw());

  /* pointer dragging: h = { hit(x,y) -> handle | null, move(handle,x,y), end() } */
  BME.drag = function (o, h) {
    const cv = o.cv;
    cv.style.touchAction = 'none';
    let cur = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      cur = h.hit(p[0], p[1]);
      if (cur !== null && cur !== undefined) {
        cv.setPointerCapture(e.pointerId);
        e.preventDefault();
        h.move(cur, p[0], p[1]);
        o.redraw();
      } else cur = null;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (cur !== null) { h.move(cur, p[0], p[1]); o.redraw(); }
      else { const t = h.hit(p[0], p[1]); cv.style.cursor = t !== null && t !== undefined ? 'grab' : 'default'; }
    });
    const up = () => { if (cur !== null && h.end) h.end(cur); cur = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  };

  /* animation loop that pauses when the canvas is off screen */
  BME.anim = function (o, step) {
    let run = false, last = 0, visible = true, id = 0;
    const a = {};
    const tick = (t) => {
      if (!run) return;
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      if (visible) { step(dt); o.redraw(); }
      id = requestAnimationFrame(tick);
    };
    Object.defineProperty(a, 'running', { get: () => run });
    a.start = () => { if (run) return; run = true; last = performance.now(); id = requestAnimationFrame(tick); if (a.onchange) a.onchange(); };
    a.stop = () => { run = false; cancelAnimationFrame(id); if (a.onchange) a.onchange(); };
    a.toggle = () => (run ? a.stop() : a.start());
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(o.cv);
    return a;
  };
  BME.playButton = function (btn, anim) {
    const b = typeof btn === 'string' ? document.getElementById(btn) : btn;
    const upd = () => { b.textContent = anim.running ? '❚❚ Pause' : '▶ Play'; b.classList.toggle('on', anim.running); };
    anim.onchange = upd;
    b.addEventListener('click', anim.toggle);
    upd();
  };

  /* ---------- controls ---------- */
  /* defs: {id,label,min,max,step,value,unit,dec,show}  |  {type:'select',id,label,options:[[v,txt]],value}
           {type:'check',id,label,value}  |  {type:'button',id,label}  |  {html:'...'} */
  BME.controls = function (el, defs, onChange) {
    const box = typeof el === 'string' ? document.getElementById(el) : el;
    const v = {};
    const setters = {};
    const labels = {};
    const fire = (k) => { if (onChange) onChange(v, k); };
    defs.forEach((d) => {
      const wrap = document.createElement('div');
      if (d.html) { wrap.innerHTML = d.html; box.appendChild(wrap); return; }
      const id = (box.id || 'c') + '-' + d.id;
      if (d.type === 'select') {
        wrap.className = 'sel';
        wrap.innerHTML = '<label for="' + id + '">' + d.label + '</label><select id="' + id + '">' +
          d.options.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>';
        const s = wrap.querySelector('select');
        s.value = d.value !== undefined ? d.value : d.options[0][0];
        v[d.id] = s.value;
        s.addEventListener('change', () => { v[d.id] = s.value; fire(d.id); });
        setters[d.id] = (x) => { s.value = x; v[d.id] = s.value; };
      } else if (d.type === 'check') {
        wrap.className = 'chk';
        wrap.innerHTML = '<input type="checkbox" id="' + id + '"><label for="' + id + '">' + d.label + '</label>';
        const c = wrap.querySelector('input');
        c.checked = !!d.value; v[d.id] = c.checked;
        c.addEventListener('change', () => { v[d.id] = c.checked; fire(d.id); });
        setters[d.id] = (x) => { c.checked = !!x; v[d.id] = c.checked; };
      } else if (d.type === 'button') {
        wrap.className = 'btnrow';
        wrap.innerHTML = '<button class="btn" type="button" id="' + id + '">' + d.label + '</button>';
        if (d.onclick) wrap.querySelector('button').addEventListener('click', d.onclick);
      } else {
        wrap.className = 'sl';
        const dec = d.dec !== undefined ? d.dec : decimalsOf(d.step);
        wrap.innerHTML = '<label for="' + id + '">' + d.label + '</label><output></output>' +
          '<input type="range" id="' + id + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + d.value + '">';
        const r = wrap.querySelector('input'), out = wrap.querySelector('output');
        const upd = () => {
          v[d.id] = parseFloat(r.value);
          out.textContent = (d.show ? d.show(v[d.id]) : v[d.id].toFixed(dec)) + (d.unit ? ' ' + d.unit : '');
        };
        upd();
        r.addEventListener('input', () => { upd(); fire(d.id); });
        setters[d.id] = (x) => { r.value = x; upd(); };
        labels[d.id] = (txt, unit) => { wrap.querySelector('label').innerHTML = txt; if (unit !== undefined) d.unit = unit; upd(); };
      }
      box.appendChild(wrap);
    });
    Object.defineProperty(v, 'relabel', { value: (k, txt, unit) => { if (labels[k]) labels[k](txt, unit); } });
    Object.defineProperty(v, 'set', { value: (k, x) => { if (setters[k]) setters[k](x); fire(k); } });
    return v;
  };

  /* readout box: rows = [[label, value, cls?], ...] */
  BME.readout = function (el, rows) {
    const box = typeof el === 'string' ? document.getElementById(el) : el;
    box.innerHTML = rows.map((r) => '<dt>' + r[0] + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + r[1] + '</dd>').join('');
  };

  /* ---------- drawing helpers ---------- */
  BME.font = (size, weight, italic) => (italic ? 'italic ' : '') + (weight || 500) + ' ' + (size || 14) + 'px ' +
    (italic ? 'Cambria, "Times New Roman", serif' : '"Segoe UI", system-ui, sans-serif');

  BME.text = function (ctx, s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = BME.font(o.size, o.weight, o.italic);
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.base || 'middle';
    if (o.bg) {
      const m = ctx.measureText(s), pw = m.width + 8, ph = (o.size || 14) + 6;
      let bx = x - pw / 2;
      if (ctx.textAlign === 'left') bx = x - 4; else if (ctx.textAlign === 'right') bx = x - pw + 4;
      ctx.globalAlpha = 0.85; ctx.fillStyle = BME.c('--surface');
      ctx.fillRect(bx, y - ph / 2, pw, ph); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = o.color || BME.c('--ink');
    ctx.fillText(s, x, y);
    ctx.restore();
  };

  BME.line = function (ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color || BME.c('--ink'); ctx.lineWidth = width || 1.5;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  };

  BME.arrow = function (ctx, x1, y1, x2, y2, color, o) {
    o = o || {};
    const w = o.width || 2.6, hd = o.head || Math.max(8, w * 3.8);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const ux = dx / L, uy = dy / L, h = Math.min(hd, L);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * h * 0.8, y2 - uy * h * 0.8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * h - uy * h * 0.45, y2 - uy * h + ux * h * 0.45);
    ctx.lineTo(x2 - ux * h + uy * h * 0.45, y2 - uy * h - ux * h * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (o.label) {
      const off = o.off !== undefined ? o.off : 16;
      const bx = o.atStart ? x1 - ux * off : x2 + ux * off;
      const by = o.atStart ? y1 - uy * off : y2 + uy * off;
      BME.text(ctx, o.label, bx + (o.dx || 0), by + (o.dy || 0), { color, size: o.size || 15, weight: 700, italic: o.italic !== false, bg: true });
    }
  };

  /* circular arrow for moments; ccw = counter-clockwise on screen */
  BME.momentArc = function (ctx, x, y, r, ccw, color, label, o) {
    o = o || {};
    const a0 = o.a0 !== undefined ? o.a0 : -0.75 * Math.PI, a1 = o.a1 !== undefined ? o.a1 : 0.75 * Math.PI;
    const w = o.width || 2.6;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1, false); ctx.stroke();
    // arrow head at the end that matches the sense (screen y down: positive angle = clockwise)
    const end = ccw ? a0 : a1;
    const dir = ccw ? -1 : 1;
    const ex = x + r * Math.cos(end), ey = y + r * Math.sin(end);
    const tx = -Math.sin(end) * dir, ty = Math.cos(end) * dir;
    const hd = 10;
    ctx.beginPath();
    ctx.moveTo(ex + tx * hd * 0.6, ey + ty * hd * 0.6);
    ctx.lineTo(ex - tx * hd * 0.5 + Math.cos(end) * hd * 0.5, ey - ty * hd * 0.5 + Math.sin(end) * hd * 0.5);
    ctx.lineTo(ex - tx * hd * 0.5 - Math.cos(end) * hd * 0.5, ey - ty * hd * 0.5 - Math.sin(end) * hd * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) BME.text(ctx, label, x + (o.lx || 0), y - r - 12 + (o.ly || 0), { color, size: 15, weight: 700, italic: true, bg: true });
  };

  BME.hatch = function (ctx, x1, y1, x2, y2, side, color) {
    // hatched ground line from (x1,y1) to (x2,y2), hatch on the given side (+1 / -1 normal)
    const c = color || BME.c('--muted');
    const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const nx = -uy * side, ny = ux * side;
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineWidth = 1;
    for (let s = 6; s < L; s += 9) {
      const px = x1 + ux * s, py = y1 + uy * s;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * 8 - ux * 6, py + ny * 8 - uy * 6); ctx.stroke();
    }
    ctx.restore();
  };

  BME.pin = function (ctx, x, y, s) {
    s = s || 14;
    ctx.save();
    ctx.fillStyle = BME.c('--surface'); ctx.strokeStyle = BME.c('--body-edge'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.4); ctx.lineTo(x + s, y + s * 1.4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.restore();
    BME.hatch(ctx, x - s * 1.5, y + s * 1.4, x + s * 1.5, y + s * 1.4, 1);
  };

  BME.roller = function (ctx, x, y, s) {
    s = s || 14;
    ctx.save();
    ctx.fillStyle = BME.c('--surface'); ctx.strokeStyle = BME.c('--body-edge'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.1); ctx.lineTo(x + s, y + s * 1.1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    [-0.55, 0.55].forEach((k) => { ctx.beginPath(); ctx.arc(x + k * s, y + s * 1.1 + 4, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); });
    ctx.restore();
    BME.hatch(ctx, x - s * 1.5, y + s * 1.1 + 8, x + s * 1.5, y + s * 1.1 + 8, 1);
  };

  /* fixed (clamped) wall: vertical line at x, hatched on side (-1 left, +1 right) */
  BME.wall = function (ctx, x, y1, y2, side) {
    BME.hatch(ctx, x, y1, x, y2, side > 0 ? -1 : 1);
  };

  BME.dim = function (ctx, x1, y1, x2, y2, label, o) {
    o = o || {};
    const c = o.color || BME.c('--muted');
    BME.arrow(ctx, (x1 + x2) / 2, (y1 + y2) / 2, x1, y1, c, { width: 1.2, head: 7 });
    BME.arrow(ctx, (x1 + x2) / 2, (y1 + y2) / 2, x2, y2, c, { width: 1.2, head: 7 });
    if (label) BME.text(ctx, label, (x1 + x2) / 2 + (o.dx || 0), (y1 + y2) / 2 + (o.dy !== undefined ? o.dy : -10), { color: c, size: 13, italic: true, bg: true });
  };

  BME.dot = function (ctx, x, y, r, fill, stroke) {
    ctx.save();
    ctx.fillStyle = fill || BME.c('--ink');
    ctx.beginPath(); ctx.arc(x, y, r || 4, 0, 2 * Math.PI); ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
  };

  /* centroid symbol (quartered circle) */
  BME.centroidMark = function (ctx, x, y, r, color) {
    r = r || 8; const c = color || BME.c('--ink');
    ctx.save(); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, Math.PI, 1.5 * Math.PI); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  /* ---------- plots ---------- */
  BME.ticks = function (a, b, n) {
    n = n || 5;
    const span = b - a;
    if (!(span > 0)) return { t: [a], step: 1 };
    const s0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(s0))), r = s0 / mag;
    const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const t = [];
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { t, step };
  };
  const tickFmt = (v, step) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));

  /* R = {x,y,w,h}; o = {xmin,xmax,ymin,ymax,xlabel,ylabel,series:[{pts,color,width,fill,dash}],marks:[{x,y,color,label}],vlines:[{x,color,label}]} */
  BME.plot = function (ctx, R, o) {
    let ymin = o.ymin, ymax = o.ymax;
    if (!(ymax > ymin)) { ymin -= 1; ymax += 1; }
    const xmin = o.xmin, xmax = o.xmax;
    const X = (v) => R.x + (v - xmin) / (xmax - xmin) * R.w;
    const Y = (v) => R.y + R.h - (v - ymin) / (ymax - ymin) * R.h;
    const muted = BME.c('--muted'), grid = BME.c('--grid'), ink = BME.c('--ink');
    ctx.save();
    ctx.font = BME.font(11);
    ctx.lineWidth = 1;
    const tx = BME.ticks(xmin, xmax, o.nx || 6), ty = BME.ticks(ymin, ymax, o.ny || 4);
    ctx.strokeStyle = grid;
    tx.t.forEach((v) => { ctx.beginPath(); ctx.moveTo(X(v), R.y); ctx.lineTo(X(v), R.y + R.h); ctx.stroke(); });
    ty.t.forEach((v) => { ctx.beginPath(); ctx.moveTo(R.x, Y(v)); ctx.lineTo(R.x + R.w, Y(v)); ctx.stroke(); });
    ctx.fillStyle = muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (!o.noXTicks) tx.t.forEach((v) => ctx.fillText(tickFmt(v, tx.step), X(v), R.y + R.h + 4));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ty.t.forEach((v) => ctx.fillText(tickFmt(v, ty.step), R.x - 5, Y(v)));
    ctx.strokeStyle = muted; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(R.x, R.y); ctx.lineTo(R.x, R.y + R.h); ctx.lineTo(R.x + R.w, R.y + R.h); ctx.stroke();
    if (ymin < 0 && ymax > 0) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(R.x, Y(0)); ctx.lineTo(R.x + R.w, Y(0)); ctx.stroke(); }
    ctx.beginPath(); ctx.rect(R.x, R.y - 2, R.w, R.h + 4); ctx.clip();
    (o.series || []).forEach((s) => {
      if (!s.pts.length) return;
      if (s.fill) {
        const y0 = Y(BME.clamp(0, ymin, ymax));
        ctx.globalAlpha = 0.16; ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.moveTo(X(s.pts[0][0]), y0);
        s.pts.forEach((p) => ctx.lineTo(X(p[0]), Y(p[1])));
        ctx.lineTo(X(s.pts[s.pts.length - 1][0]), y0); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2.2;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      ctx.stroke(); ctx.setLineDash([]);
    });
    (o.vlines || []).forEach((l) => {
      ctx.strokeStyle = l.color || muted; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X(l.x), R.y); ctx.lineTo(X(l.x), R.y + R.h); ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.restore();
    (o.marks || []).forEach((m) => {
      BME.dot(ctx, X(m.x), Y(m.y), m.r || 5, m.color || ink);
      if (m.label) BME.text(ctx, m.label, X(m.x) + (m.dx || 8), Y(m.y) + (m.dy || -12), { color: m.color || ink, size: 12, align: m.align || 'left', bg: true, weight: 600 });
    });
    if (o.xlabel) BME.text(ctx, o.xlabel, R.x + R.w, R.y + R.h + 22, { color: muted, size: 12, align: 'right' });
    if (o.ylabel) BME.text(ctx, o.ylabel, R.x + 4, R.y - 10, { color: muted, size: 12, align: 'left', weight: 600 });
    return { X, Y };
  };

  /* ---------- linear solver (Gaussian elimination with partial pivoting) ---------- */
  BME.solve = function (A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      const t = M[c]; M[c] = M[p]; M[p] = t;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  };

  /* ---------- page chrome: header, toc, pager, keys, quizzes ---------- */
  function setTheme(t) {
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    try { if (t) localStorage.setItem('bme-theme', t); else localStorage.removeItem('bme-theme'); } catch (e) { /* storage unavailable */ }
    requestAnimationFrame(BME.redrawAll);
  }
  try { const t = localStorage.getItem('bme-theme'); if (t) root.setAttribute('data-theme', t); } catch (e) { /* ignore */ }
  const isDark = () => {
    const t = root.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  };
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(BME.redrawAll));

  function toggleBody(cls, btn) {
    const on = document.body.classList.toggle(cls);
    if (btn) btn.classList.toggle('on', on);
    try { localStorage.setItem('bme-' + cls, on ? '1' : ''); } catch (e) { /* ignore */ }
  }

  function buildChrome() {
    const body = document.body;
    const n = parseInt(body.dataset.lecture || '0', 10);
    const L = BME.LECTURES.find((l) => l.n === n);
    const top = document.createElement('header');
    top.className = 'top';
    top.innerHTML =
      '<a class="brand" href="index.html" title="Course overview">BME</a>' +
      '<span class="crumb">' + (L ? 'Lecture ' + n + ' / ' + BME.LECTURES.length + ' · ' + L.title : document.title) + '</span>' +
      '<span class="tools">' +
      (L ? '<button class="btn" id="bme-notes" title="Show lecturer notes (T)">Notes</button>' : '') +
      '<button class="btn" id="bme-pres" title="Larger text for the projector (P)">A+</button>' +
      '<button class="btn" id="bme-theme" title="Light / dark (D)">◐</button>' +
      '</span><span class="progress" id="bme-progress"></span>';
    body.insertBefore(top, body.firstChild);

    const nb = document.getElementById('bme-notes'), pb = document.getElementById('bme-pres');
    try {
      if (localStorage.getItem('bme-show-notes') === '1' && nb) { body.classList.add('show-notes'); nb.classList.add('on'); }
      if (localStorage.getItem('bme-presenter') === '1') { body.classList.add('presenter'); pb.classList.add('on'); }
    } catch (e) { /* ignore */ }
    if (nb) nb.addEventListener('click', () => toggleBody('show-notes', nb));
    pb.addEventListener('click', () => toggleBody('presenter', pb));
    document.getElementById('bme-theme').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));

    const secs = Array.prototype.slice.call(document.querySelectorAll('section.slide'));
    secs.forEach((s, i) => {
      const num = document.createElement('div');
      num.className = 'slide-num';
      num.textContent = (L ? n + '.' : '') + (i + 1);
      s.insertBefore(num, s.firstChild);
    });
    const toc = document.querySelector('.toc');
    let links = [];
    if (toc) {
      toc.innerHTML = '<div class="toc-title">' + (L ? 'In this lecture' : 'Contents') + '</div><ol>' +
        secs.map((s, i) => { const h = s.querySelector('h2'); return '<li><a href="#' + s.id + '">' + (i + 1) + '. ' + (h ? h.textContent : s.id) + '</a></li>'; }).join('') + '</ol>';
      links = Array.prototype.slice.call(toc.querySelectorAll('a'));
    }
    const prog = document.getElementById('bme-progress');
    const current = () => { let k = -1; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) k = i; }); return k; };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      prog.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
      const k = current();
      links.forEach((a, i) => a.classList.toggle('active', i === k));
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const main = document.querySelector('main');
    if (main && L) {
      const prev = BME.LECTURES.find((l) => l.n === n - 1), next = BME.LECTURES.find((l) => l.n === n + 1);
      const pg = document.createElement('nav');
      pg.className = 'pager';
      pg.innerHTML = (prev ? '<a href="' + prev.file + '">← Lecture ' + prev.n + ': ' + prev.title + '</a>' : '<a href="index.html">← Course overview</a>') +
        (next ? '<a href="' + next.file + '">Lecture ' + next.n + ': ' + next.title + ' →</a>' : '<a href="index.html">Course overview →</a>');
      main.appendChild(pg);
      const k = document.createElement('p');
      k.className = 'keys';
      k.innerHTML = 'Keys: <kbd>→</kbd>/<kbd>←</kbd> next/previous section · <kbd>T</kbd> lecturer notes · <kbd>P</kbd> projector text size · <kbd>D</kbd> dark mode';
      main.appendChild(k);
    }

    addEventListener('keydown', (e) => {
      const tg = e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const k = current();
        const t = e.key === 'ArrowRight' ? Math.min(secs.length - 1, k + 1) : Math.max(0, k - 1);
        if (secs[t]) { secs[t].scrollIntoView({ behavior: 'smooth' }); e.preventDefault(); }
      } else if (e.key === 't' || e.key === 'T') { if (nb) toggleBody('show-notes', nb); }
      else if (e.key === 'p' || e.key === 'P') toggleBody('presenter', pb);
      else if (e.key === 'd' || e.key === 'D') setTheme(isDark() ? 'light' : 'dark');
    });

    document.querySelectorAll('.quiz').forEach((q) => {
      q.querySelectorAll('button.opt').forEach((b) => {
        b.addEventListener('click', () => {
          q.querySelectorAll('button.opt').forEach((x) => x.classList.remove('right', 'wrong'));
          if (b.hasAttribute('data-ok')) b.classList.add('right');
          else { b.classList.add('wrong'); const ok = q.querySelector('button.opt[data-ok]'); if (ok) ok.classList.add('right'); }
          q.classList.add('done');
        });
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildChrome);
  else buildChrome();
})();
