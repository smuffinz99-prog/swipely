/* Swipely editor — vanilla JS, no build step, no runtime dependencies.
 * Everything renders client-side to a <canvas>, so there is zero per-user
 * server cost. Slides export as 1080x1350 PNGs (the 4:5 portrait size that
 * looks right on both LinkedIn and Instagram).
 */
(function () {
  'use strict';

  var BRAND = 'Swipely';          // change this one constant to rebrand everything
  var W = 1080, H = 1350;         // export resolution (4:5 portrait)
  var STORAGE_KEY = 'swipely.project.v1';
  var USAGE_KEY = 'swipely.usage.v1';
  var FREE_DAILY_EXPORTS = 1;     // free plan: carousels (downloads) per day before Pro
  var PRO_PRICE = '$6';           // Pro price, shown in the upsell + watermark note
  var PRO_KEY = 'swipely.pro.v1'; // persisted Pro flag (survives reloads, separate from project)

  // ── Checkout (Stripe Payment Link) ───────────────────────────────────────────
  // To go live: in the Stripe Dashboard create a Payment Link for the $6/mo Pro
  // subscription, set its post-payment redirect to:  <your-domain>/app.html?pro=success
  // then paste the link URL below. Until then, "Get Pro" falls back to Preview.
  // This is the only step that needs the account owner — ~5 minutes, no code.
  var PRO_CHECKOUT_URL = 'https://buy.stripe.com/28E4gy7r79Tw0Az9zbb3q00';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    templateId: 'midnight',
    brandName: 'Your Name',
    brandHandle: '@yourhandle',
    textSize: 'M',                // S | M | L
    format: 'portrait',           // portrait | square  (square is Pro)
    brand: { custom: false, bg: '#0f172a', title: '#ffffff', accent: '#38bdf8' }, // Pro custom colors
    isPro: false,                 // flips when Stripe/paid tier lands
    current: 0,
    slides: [
      { title: '5 lessons that\ndoubled my reach', body: 'Swipe to steal the exact playbook I used to grow from 0 to 50k in 6 months. →' },
      { title: 'Lesson 1', body: 'Hook in the first 3 words or you have already lost. People decide to swipe in under a second.' },
      { title: 'Lesson 2', body: 'One idea per slide. Crowded slides get skipped. White space is not wasted space.' },
      { title: 'Found this useful?', body: 'Follow for a new playbook every week. And repost the first slide to help someone else.' },
    ],
  };

  var SIZE_SCALE = { S: 0.85, M: 1, L: 1.18 };

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('canvas');
  var ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // Export formats. Square is a Pro size; portrait 4:5 is the free default.
  var FORMATS = {
    portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', pro: false },
    square:   { w: 1080, h: 1080, label: 'Square 1:1', pro: true },
  };
  function applyFormat() {
    var f = FORMATS[state.format] || FORMATS.portrait;
    W = f.w; H = f.h;
    canvas.width = W; canvas.height = H;
  }

  // Blend two hex colors (t=0 -> a, t=1 -> b). Used to derive custom-color shades.
  function mix(a, b, t) {
    function parse(h) {
      h = h.replace('#', '');
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function hex(n) { return ('0' + Math.round(n).toString(16)).slice(-2); }
    var A = parse(a), B = parse(b);
    return '#' + hex(A[0] + (B[0] - A[0]) * t) + hex(A[1] + (B[1] - A[1]) * t) + hex(A[2] + (B[2] - A[2]) * t);
  }

  // The template actually painted: the chosen theme, or a custom-color override
  // when a Pro user has turned custom colors on.
  function effectiveTemplate() {
    var tpl = window.getTemplate(state.templateId);
    if (state.isPro && state.brand.custom) {
      var bg = state.brand.bg, title = state.brand.title, accent = state.brand.accent;
      return {
        id: 'custom', name: 'Custom', pro: true, font: tpl.font,
        bg: { type: 'solid', color: bg },
        titleColor: title,
        bodyColor: mix(title, bg, 0.3),
        accentColor: accent,
        pageColor: mix(title, bg, 0.55),
        brandColor: title,
        watermarkColor: mix(title, bg, 0.7),
      };
    }
    return tpl;
  }

  // ── Persistence ──────────────────────────────────────────────────────────────
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.slides) && saved.slides.length) {
        // keep isPro from code default; everything else from storage
        state.templateId = saved.templateId || state.templateId;
        state.brandName = saved.brandName || state.brandName;
        state.brandHandle = saved.brandHandle || state.brandHandle;
        state.textSize = saved.textSize || state.textSize;
        state.format = saved.format || state.format;
        if (saved.brand) {
          state.brand.custom = !!saved.brand.custom;
          state.brand.bg = saved.brand.bg || state.brand.bg;
          state.brand.title = saved.brand.title || state.brand.title;
          state.brand.accent = saved.brand.accent || state.brand.accent;
        }
        state.slides = saved.slides;
        state.current = Math.min(saved.current || 0, saved.slides.length - 1);
      }
    } catch (e) {}
  }

  // ── Text helpers ─────────────────────────────────────────────────────────────
  // Wrap text to maxWidth, honoring explicit \n line breaks.
  function wrapText(text, font, maxWidth) {
    ctx.font = font;
    var lines = [];
    (text || '').split('\n').forEach(function (para) {
      var words = para.split(' ');
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = words[i];
        } else {
          line = test;
        }
      }
      lines.push(line);
    });
    return lines;
  }

  // ── Pattern overlays ─────────────────────────────────────────────────────────
  function drawPatternOverlay(c, tpl) {
    c.save();
    var col = tpl.titleColor || '#ffffff';
    if (tpl.overlay === 'damask')        { overlayDamask(c, col); }
    if (tpl.overlay === 'baroque')       { overlayBaroque(c, col); }
    if (tpl.overlay === 'art-deco')      { overlayArtDeco(c, col); }
    if (tpl.overlay === 'cathedral')     { overlayCathedral(c, col); }
    if (tpl.overlay === 'manuscript')    { overlayManuscript(c, col); }
    if (tpl.overlay === 'stained-arch')  { overlayStainedArch(c, col); }
    if (tpl.overlay === 'lattice')       { overlayLattice(c, col); }
    if (tpl.overlay === 'wave-lines')    { overlayWaveLines(c, col); }
    if (tpl.overlay === 'sunburst')      { overlaySunburst(c, col); }
    if (tpl.overlay === 'engraving')     { overlayEngraving(c, col); }
    if (tpl.overlay === 'chevron')       { overlayChevron(c, col); }
    if (tpl.overlay === 'mandala')       { overlayMandala(c, col); }
    if (tpl.overlay === 'geometry')      { overlayGeometry(c, col); }
    c.restore();
  }

  // ── Damask: filled gothic floral tile + bold border ───────────────────────────
  function overlayDamask(c, col) {
    c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 1.5;
    c.globalAlpha = 0.22;
    var s = 170;
    for (var row = -1; row <= Math.ceil(H / s) + 1; row++) {
      for (var col2 = -1; col2 <= Math.ceil(W / s) + 1; col2++) {
        var ox = (Math.abs(row) % 2) ? s / 2 : 0;
        damaskTile(c, col2 * s + ox, row * s, s);
      }
    }
    var m = 58;
    c.globalAlpha = 0.55; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.25; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.65;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      c.beginPath(); c.arc(p[0], p[1], 9, 0, Math.PI * 2); c.fill();
    });
  }
  function damaskTile(c, cx, cy, s) {
    var r = s * 0.30;
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.quadraticCurveTo(cx + r * 0.68, cy - r * 0.68, cx + r * 0.74, cy);
    c.quadraticCurveTo(cx + r * 0.68, cy + r * 0.68, cx, cy + r);
    c.quadraticCurveTo(cx - r * 0.68, cy + r * 0.68, cx - r * 0.74, cy);
    c.quadraticCurveTo(cx - r * 0.68, cy - r * 0.68, cx, cy - r);
    c.closePath(); c.fill();
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(function (a) {
      c.beginPath();
      c.ellipse(cx + Math.cos(a) * r * 1.36, cy + Math.sin(a) * r * 1.36, r * 0.32, r * 0.13, a, 0, Math.PI * 2);
      c.fill();
    });
    [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4].forEach(function (a) {
      c.beginPath(); c.arc(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88, 4, 0, Math.PI * 2); c.fill();
    });
  }

  // ── Baroque: heavy frame + corner diamonds + bead border + scrollwork ─────────
  function overlayBaroque(c, col) {
    c.fillStyle = col; c.strokeStyle = col;
    var m = 65;
    c.globalAlpha = 0.55; c.lineWidth = 6; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.25; c.lineWidth = 1.5;
    c.strokeRect(m + 18, m + 18, W - m * 2 - 36, H - m * 2 - 36);
    c.strokeRect(m + 30, m + 30, W - m * 2 - 60, H - m * 2 - 60);
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      var d = 22;
      c.globalAlpha = 0.60;
      c.beginPath(); c.moveTo(p[0], p[1] - d); c.lineTo(p[0] + d, p[1]); c.lineTo(p[0], p[1] + d); c.lineTo(p[0] - d, p[1]); c.closePath(); c.fill();
      c.save(); c.globalAlpha = 0.22; c.lineWidth = 1.5; c.beginPath(); c.arc(p[0], p[1], 36, 0, Math.PI * 2); c.stroke(); c.restore();
    });
    c.globalAlpha = 0.42;
    var nb = 13;
    for (var i = 1; i < nb; i++) {
      var bx = m + i * (W - m * 2) / nb;
      c.beginPath(); c.arc(bx, m, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(bx, H - m, 5, 0, Math.PI * 2); c.fill();
    }
    var nbs = 16;
    for (var j = 1; j < nbs; j++) {
      var by = m + j * (H - m * 2) / nbs;
      c.beginPath(); c.arc(m, by, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(W - m, by, 5, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 0.55;
    [[W / 2, m], [W / 2, H - m], [m, H / 2], [W - m, H / 2]].forEach(function (p) {
      var d = 16; c.beginPath();
      c.moveTo(p[0], p[1] - d); c.lineTo(p[0] + d, p[1]); c.lineTo(p[0], p[1] + d); c.lineTo(p[0] - d, p[1]); c.closePath(); c.fill();
    });
    c.globalAlpha = 0.30; c.lineWidth = 2.5;
    [[m + 50, m + 50, 0], [W - m - 50, m + 50, Math.PI / 2], [W - m - 50, H - m - 50, Math.PI], [m + 50, H - m - 50, Math.PI * 3 / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); c.rotate(pt[2]);
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(45, 0, 70, 22, 64, 50); c.bezierCurveTo(58, 72, 35, 75, 22, 60); c.bezierCurveTo(9, 45, 18, 28, 30, 34); c.stroke();
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(0, 45, 22, 70, 50, 64); c.bezierCurveTo(72, 58, 75, 35, 60, 22); c.bezierCurveTo(45, 9, 28, 18, 34, 30); c.stroke();
      c.restore();
    });
  }

  // ── Art Deco: dramatic fan rays + concentric arcs + stepped corners ───────────
  function overlayArtDeco(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var fx = W / 2, fy = H + 100;
    c.globalAlpha = 0.28; c.lineWidth = 2;
    for (var i = 0; i < 42; i++) {
      var a = -Math.PI + (Math.PI * i / 41);
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(a) * H * 1.5, fy + Math.sin(a) * H * 1.5); c.stroke();
    }
    c.globalAlpha = 0.22; c.lineWidth = 3;
    [220, 440, 660, 880, 1100].forEach(function (r) {
      c.beginPath(); c.arc(fx, fy, r, -Math.PI, 0); c.stroke();
    });
    var m = 72;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.20; c.lineWidth = 1.5; c.strokeRect(m + 18, m + 18, W - m * 2 - 36, H - m * 2 - 36);
    c.globalAlpha = 0.48; c.lineWidth = 3;
    [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]].forEach(function (pt) {
      var x = pt[0], y = pt[1], sx = pt[2], sy = pt[3], sz = 80;
      c.beginPath(); c.moveTo(x + sx * sz, y); c.lineTo(x, y); c.lineTo(x, y + sy * sz); c.stroke();
      c.beginPath(); c.moveTo(x + sx * sz * 0.55, y + sy * 20); c.lineTo(x + sx * 20, y + sy * 20); c.lineTo(x + sx * 20, y + sy * sz * 0.55); c.stroke();
      var d = 18;
      c.beginPath(); c.moveTo(x + sx * d, y); c.lineTo(x + sx * d * 2, y + sy * d); c.lineTo(x + sx * d, y + sy * d * 2); c.lineTo(x, y + sy * d); c.closePath(); c.fill();
    });
  }

  // ── Cathedral: filled arches + rose window ────────────────────────────────────
  function overlayCathedral(c, col) {
    c.fillStyle = col; c.strokeStyle = col;
    var archW = 190, archH = 420;
    c.globalAlpha = 0.18;
    for (var i = -1; i < Math.ceil(W / archW) + 2; i++) {
      gothicArch(c, i * archW + archW / 2, H, archW * 0.9, archH, true);
    }
    c.globalAlpha = 0.09;
    for (var j = -1; j < Math.ceil(W / 90) + 2; j++) {
      gothicArch(c, j * 90 + 45, H - archH + 200, 82, 200, false);
    }
    var m = 70;
    c.globalAlpha = 0.48; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.18; c.lineWidth = 1.5; c.strokeRect(m + 18, m + 18, W - m * 2 - 36, H - m * 2 - 36);
    var rcx = W / 2, rcy = 275, rr = 145;
    c.globalAlpha = 0.24; c.lineWidth = 3;
    c.beginPath(); c.arc(rcx, rcy, rr, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(rcx, rcy, rr * 0.64, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.28; c.beginPath(); c.arc(rcx, rcy, rr * 0.22, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.18;
    for (var k = 0; k < 8; k++) {
      c.beginPath(); c.arc(rcx + Math.cos(k * Math.PI / 4) * rr * 0.84, rcy + Math.sin(k * Math.PI / 4) * rr * 0.84, rr * 0.20, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 0.24; c.lineWidth = 2;
    for (var l = 0; l < 8; l++) {
      var spa = l * Math.PI / 4;
      c.beginPath(); c.moveTo(rcx + Math.cos(spa) * rr * 0.22, rcy + Math.sin(spa) * rr * 0.22); c.lineTo(rcx + Math.cos(spa) * rr * 0.64, rcy + Math.sin(spa) * rr * 0.64); c.stroke();
    }
  }
  function gothicArch(c, cx, base, w, h, fill) {
    var hw = w / 2;
    c.beginPath();
    c.moveTo(cx - hw, base); c.lineTo(cx - hw, base - h * 0.38);
    c.bezierCurveTo(cx - hw, base - h * 0.88, cx - hw * 0.08, base - h, cx, base - h);
    c.bezierCurveTo(cx + hw * 0.08, base - h, cx + hw, base - h * 0.88, cx + hw, base - h * 0.38);
    c.lineTo(cx + hw, base); c.closePath();
    if (fill) c.fill(); else c.stroke();
  }

  // ── Manuscript: bold triple frame + corner flourishes ─────────────────────────
  function overlayManuscript(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var m = 54;
    c.globalAlpha = 0.65; c.lineWidth = 4.5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.28; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.14; c.strokeRect(m + 30, m + 30, W - m * 2 - 60, H - m * 2 - 60);
    c.globalAlpha = 0.60; c.lineWidth = 2.5;
    [[m, m, 0], [W - m, m, Math.PI / 2], [W - m, H - m, Math.PI], [m, H - m, Math.PI * 3 / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); c.rotate(pt[2]); manuscriptCorner(c, 90); c.restore();
    });
    c.globalAlpha = 0.50;
    [[W / 2, m], [W / 2, H - m], [m, H / 2], [W - m, H / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); manuscriptMidmark(c, 14); c.restore();
    });
    c.globalAlpha = 0.12; c.lineWidth = 1;
    [H * 0.28, H * 0.52, H * 0.76].forEach(function (y) {
      c.beginPath(); c.moveTo(m + 48, y); c.lineTo(W - m - 48, y); c.stroke();
    });
  }
  function manuscriptCorner(c, sz) {
    c.beginPath(); c.moveTo(sz, 0); c.lineTo(0, 0); c.lineTo(0, sz); c.stroke();
    c.beginPath(); c.moveTo(sz * 0.5, 0); c.lineTo(sz * 0.5, sz * 0.2); c.lineTo(sz * 0.2, sz * 0.2); c.lineTo(sz * 0.2, sz * 0.5); c.lineTo(0, sz * 0.5); c.stroke();
    var d = 13; c.beginPath(); c.moveTo(0, -d); c.lineTo(d, 0); c.lineTo(0, d); c.lineTo(-d, 0); c.closePath(); c.fill();
    [sz * 0.36, sz * 0.60, sz * 0.82].forEach(function (dv) {
      c.beginPath(); c.arc(dv, 0, 4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0, dv, 4, 0, Math.PI * 2); c.fill();
    });
  }
  function manuscriptMidmark(c, r) {
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.65, 0); c.lineTo(0, r); c.lineTo(-r * 0.65, 0); c.closePath(); c.fill();
  }

  // ── Stained Arch: gothic arch with glass division lines ───────────────────────
  function overlayStainedArch(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var cx = W / 2, tip = 90, base = H * 0.52, hw = W * 0.43;
    // Arch fill
    c.globalAlpha = 0.07;
    c.beginPath();
    c.moveTo(cx - hw, base); c.lineTo(cx - hw, base * 0.52);
    c.bezierCurveTo(cx - hw, base * 0.06, cx - hw * 0.06, tip, cx, tip);
    c.bezierCurveTo(cx + hw * 0.06, tip, cx + hw, base * 0.06, cx + hw, base * 0.52);
    c.lineTo(cx + hw, base); c.closePath(); c.fill();
    // Arch outline
    c.globalAlpha = 0.50; c.lineWidth = 6;
    c.beginPath();
    c.moveTo(cx - hw, base); c.lineTo(cx - hw, base * 0.52);
    c.bezierCurveTo(cx - hw, base * 0.06, cx - hw * 0.06, tip, cx, tip);
    c.bezierCurveTo(cx + hw * 0.06, tip, cx + hw, base * 0.06, cx + hw, base * 0.52);
    c.lineTo(cx + hw, base); c.stroke();
    // Central spine
    c.globalAlpha = 0.32; c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx, tip + 8); c.lineTo(cx, base); c.stroke();
    // Horizontal leading lines
    c.globalAlpha = 0.26; c.lineWidth = 2.5;
    for (var i = 1; i < 5; i++) {
      var y = tip + i * (base - tip) / 5;
      var t = (y - tip) / (base - tip);
      var xw = hw * Math.sqrt(1 - Math.pow(1 - t, 2)) * 0.88;
      c.beginPath(); c.moveTo(cx - xw, y); c.lineTo(cx + xw, y); c.stroke();
    }
    // Diagonal glass lines
    c.globalAlpha = 0.18; c.lineWidth = 1.5;
    for (var d = -5; d <= 5; d++) {
      var off = d * 130;
      c.beginPath(); c.moveTo(cx + off - 220, tip); c.lineTo(cx + off + 220, base); c.stroke();
      c.beginPath(); c.moveTo(cx + off + 220, tip); c.lineTo(cx + off - 220, base); c.stroke();
    }
    // Trefoil at tip
    c.globalAlpha = 0.40; c.lineWidth = 2;
    [0, Math.PI * 2 / 3, Math.PI * 4 / 3].forEach(function (a) {
      c.beginPath(); c.arc(cx + Math.cos(a - Math.PI / 2) * 26, tip + 30 + Math.sin(a - Math.PI / 2) * 26, 18, 0, Math.PI * 2); c.stroke();
    });
    // Frame border
    var m = 58;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
  }

  // ── Lattice: rotated diamond trellis grid ─────────────────────────────────────
  function overlayLattice(c, col) {
    c.strokeStyle = col; c.lineWidth = 2; c.globalAlpha = 0.20;
    var s = 80, ext = Math.max(W, H) * 1.25, steps = Math.ceil(ext / s) + 2;
    c.save();
    c.translate(W / 2, H / 2); c.rotate(Math.PI / 4);
    for (var i = -steps; i <= steps; i++) {
      c.beginPath(); c.moveTo(i * s, -ext); c.lineTo(i * s, ext); c.stroke();
    }
    for (var j = -steps; j <= steps; j++) {
      c.beginPath(); c.moveTo(-ext, j * s); c.lineTo(ext, j * s); c.stroke();
    }
    c.restore();
    var m = 60;
    c.globalAlpha = 0.55; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.25; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.62;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      var d = 20; c.beginPath();
      c.moveTo(p[0], p[1] - d); c.lineTo(p[0] + d, p[1]); c.lineTo(p[0], p[1] + d); c.lineTo(p[0] - d, p[1]); c.closePath(); c.fill();
    });
  }

  // ── Wave Lines: layered sine waves fading upward ─────────────────────────────
  function overlayWaveLines(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var numWaves = 24;
    for (var i = 0; i < numWaves; i++) {
      var y0 = H * 0.38 + i * 40;
      var fade = Math.max(0, 1 - i / numWaves);
      c.globalAlpha = 0.30 * fade;
      c.lineWidth = Math.max(1, 2.5 - i * 0.07);
      c.beginPath();
      for (var s = 0; s <= 20; s++) {
        var x = (s / 20) * W;
        var y = y0 + Math.sin((s / 20) * Math.PI * 3.5 + i * 0.6) * 32;
        if (s === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    var m = 60;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.62;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      c.beginPath(); c.arc(p[0], p[1], 8, 0, Math.PI * 2); c.fill();
    });
  }

  // ── Sunburst: alternating wedges + radial spokes + concentric rings ──────────
  function overlaySunburst(c, col) {
    c.fillStyle = col; c.strokeStyle = col;
    var cx = W / 2, cy = H / 2;
    var maxR = Math.sqrt(W * W + H * H);
    var numRays = 24;
    // Alternating filled wedges
    c.globalAlpha = 0.12;
    for (var i = 0; i < numRays; i++) {
      if (i % 2 === 0) {
        var a1 = (i / numRays) * Math.PI * 2 - Math.PI / 2;
        var a2 = ((i + 0.88) / numRays) * Math.PI * 2 - Math.PI / 2;
        c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, maxR, a1, a2); c.closePath(); c.fill();
      }
    }
    // Radial spokes
    c.globalAlpha = 0.20; c.lineWidth = 1.5;
    for (var j = 0; j < numRays; j++) {
      var angle = (j / numRays) * Math.PI * 2 - Math.PI / 2;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR); c.stroke();
    }
    // Concentric rings
    c.globalAlpha = 0.18; c.lineWidth = 2;
    [120, 240, 360, 480, 620].forEach(function (r) {
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    });
    // Filled center hub
    c.globalAlpha = 0.30; c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.18; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 68, 0, Math.PI * 2); c.stroke();
    // Bold border
    var m = 60;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
  }

  // ── Engraving: fine cross-hatch diagonal grid ─────────────────────────────────
  function overlayEngraving(c, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
    var sp = 26, ext = Math.max(W, H) * 1.5, steps = Math.ceil(ext / sp) + 2;
    // 45° lines
    c.globalAlpha = 0.14;
    c.save(); c.translate(W / 2, H / 2); c.rotate(Math.PI / 4);
    for (var i = -steps; i <= steps; i++) {
      c.beginPath(); c.moveTo(i * sp, -ext); c.lineTo(i * sp, ext); c.stroke();
    }
    c.restore();
    // −45° lines
    c.save(); c.translate(W / 2, H / 2); c.rotate(-Math.PI / 4);
    for (var j = -steps; j <= steps; j++) {
      c.beginPath(); c.moveTo(j * sp, -ext); c.lineTo(j * sp, ext); c.stroke();
    }
    c.restore();
    // Bold border
    var m = 60;
    c.globalAlpha = 0.55; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.25; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    // Corner diamonds
    c.globalAlpha = 0.62;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      var d = 18; c.beginPath();
      c.moveTo(p[0], p[1] - d); c.lineTo(p[0] + d, p[1]); c.lineTo(p[0], p[1] + d); c.lineTo(p[0] - d, p[1]); c.closePath(); c.fill();
    });
  }

  // ── Chevron: bold zigzag stripe rows ─────────────────────────────────────────
  function overlayChevron(c, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 4; c.globalAlpha = 0.26;
    var depth = 40, segW = 88, rowSp = 62;
    var numRows = Math.ceil(H / rowSp) + 3;
    var numSegs = Math.ceil(W / segW) + 3;
    for (var row = -1; row < numRows; row++) {
      var y0 = row * rowSp;
      c.beginPath(); c.moveTo(-segW, y0);
      for (var seg = 0; seg < numSegs; seg++) {
        var x = (seg - 1) * segW;
        c.lineTo(x + segW / 2, y0 - depth);
        c.lineTo(x + segW, y0);
      }
      c.stroke();
    }
    var m = 60;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.62;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      c.beginPath(); c.arc(p[0], p[1], 9, 0, Math.PI * 2); c.fill();
    });
  }

  // ── Mandala: concentric rings + radial petals + spokes ───────────────────────
  function overlayMandala(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var cx = W / 2, cy = H / 2;
    // Concentric rings
    c.globalAlpha = 0.22; c.lineWidth = 2.5;
    [70, 150, 230, 310, 390, 470].forEach(function (r) {
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    });
    // 16 radial spokes
    c.globalAlpha = 0.16; c.lineWidth = 1.5;
    for (var s = 0; s < 16; s++) {
      var sa = s * Math.PI / 8;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(sa) * 470, cy + Math.sin(sa) * 470); c.stroke();
    }
    // Petal dots at ring intersections
    c.globalAlpha = 0.22;
    [[8, 150], [16, 230], [24, 310]].forEach(function (rp) {
      for (var k = 0; k < rp[0]; k++) {
        var a = k * Math.PI * 2 / rp[0];
        c.beginPath(); c.arc(cx + Math.cos(a) * rp[1], cy + Math.sin(a) * rp[1], rp[1] * 0.078, 0, Math.PI * 2); c.fill();
      }
    });
    // 8 inner elliptical petals
    c.globalAlpha = 0.16;
    for (var p = 0; p < 8; p++) {
      var pa = p * Math.PI / 4;
      c.beginPath();
      c.ellipse(cx + Math.cos(pa) * 110, cy + Math.sin(pa) * 110, 30, 13, pa, 0, Math.PI * 2);
      c.fill();
    }
    // Center
    c.globalAlpha = 0.32; c.beginPath(); c.arc(cx, cy, 36, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.18; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 56, 0, Math.PI * 2); c.stroke();
    // Bold border
    var m = 60;
    c.globalAlpha = 0.50; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
  }

  // ── Geometry: large corner triangles + fine triangle grid ────────────────────
  function overlayGeometry(c, col) {
    c.fillStyle = col; c.strokeStyle = col;
    // Large bold triangle corners
    [[0, 0, W * 0.55, 0, 0, H * 0.42, 0.10],
     [W, 0, W * 0.45, 0, W, H * 0.42, 0.07],
     [0, H, W * 0.45, H, 0, H * 0.58, 0.10],
     [W, H, W * 0.55, H, W, H * 0.58, 0.07]].forEach(function (t) {
      c.globalAlpha = t[6];
      c.beginPath(); c.moveTo(t[0], t[1]); c.lineTo(t[2], t[3]); c.lineTo(t[4], t[5]); c.closePath(); c.fill();
    });
    // Fine triangle tessellation grid
    c.globalAlpha = 0.15; c.lineWidth = 1.5;
    var gW = 130, gH = 112, nC = Math.ceil(W / gW) + 2, nR = Math.ceil(H / gH) + 2;
    for (var row = -1; row < nR; row++) {
      for (var col2 = -1; col2 < nC; col2++) {
        var ox = (Math.abs(row) % 2) ? gW / 2 : 0;
        var tx = col2 * gW + ox, ty = row * gH;
        c.beginPath(); c.moveTo(tx, ty + gH); c.lineTo(tx + gW / 2, ty); c.lineTo(tx + gW, ty + gH); c.closePath(); c.stroke();
      }
    }
    // Alternate fill on some cells
    c.globalAlpha = 0.07;
    for (var r2 = -1; r2 < nR; r2++) {
      for (var c2 = -1; c2 < nC; c2++) {
        if ((r2 + c2) % 3 === 0) {
          var ox2 = (Math.abs(r2) % 2) ? gW / 2 : 0;
          var tx2 = c2 * gW + ox2, ty2 = r2 * gH;
          c.beginPath(); c.moveTo(tx2, ty2 + gH); c.lineTo(tx2 + gW / 2, ty2); c.lineTo(tx2 + gW, ty2 + gH); c.closePath(); c.fill();
        }
      }
    }
    // Bold border
    var m = 60;
    c.globalAlpha = 0.52; c.lineWidth = 5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.22; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    c.globalAlpha = 0.62;
    [[m, m], [W - m, m], [W - m, H - m], [m, H - m]].forEach(function (p) {
      var d = 18; c.beginPath();
      c.moveTo(p[0], p[1] - d); c.lineTo(p[0] + d, p[1]); c.lineTo(p[0], p[1] + d); c.lineTo(p[0] - d, p[1]); c.closePath(); c.fill();
    });
  }

  // ── The renderer ─────────────────────────────────────────────────────────────
  function paintSlide(c, slide, idx, total, tpl, showWatermark) {
    c.save();
    var pad = 96;
    var scale = SIZE_SCALE[state.textSize] || 1;

    // background
    if (tpl.bg.type === 'gradient') {
      var a = (tpl.bg.angle || 0) * Math.PI / 180;
      var x = Math.cos(a), y = Math.sin(a);
      var g = c.createLinearGradient(
        W / 2 - x * W / 2, H / 2 - y * H / 2,
        W / 2 + x * W / 2, H / 2 + y * H / 2
      );
      g.addColorStop(0, tpl.bg.from);
      g.addColorStop(1, tpl.bg.to);
      c.fillStyle = g;
    } else {
      c.fillStyle = tpl.bg.color;
    }
    c.fillRect(0, 0, W, H);

    // pattern overlay
    if (tpl.overlay) { drawPatternOverlay(c, tpl); }

    // top accent bar (small brand cue, also makes blank slides look intentional)
    c.fillStyle = tpl.accentColor;
    c.fillRect(pad, pad, 88, 10);

    // page indicator (top-right)
    c.fillStyle = tpl.pageColor;
    c.font = '600 30px ' + tpl.font;
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.fillText((idx + 1) + ' / ' + total, W - pad, pad - 6);

    // ── body block, vertically centred-ish in the safe area ──
    c.textAlign = 'left';
    var maxW = W - pad * 2;

    var titleFont = '800 ' + Math.round(82 * scale) + 'px ' + tpl.font;
    var titleLines = wrapText(slide.title, titleFont, maxW);
    var titleLH = Math.round(94 * scale);

    var bodyFont = '400 ' + Math.round(40 * scale) + 'px ' + tpl.font;
    var bodyLines = slide.body ? wrapText(slide.body, bodyFont, maxW) : [];
    var bodyLH = Math.round(56 * scale);

    var gap = bodyLines.length ? 44 : 0;
    var blockH = titleLines.length * titleLH + gap + bodyLines.length * bodyLH;
    var top = (H - blockH) / 2 - 40;
    if (top < pad + 80) top = pad + 80;

    // title
    c.fillStyle = tpl.titleColor;
    c.font = titleFont;
    c.textBaseline = 'top';
    var ty = top;
    titleLines.forEach(function (ln) { c.fillText(ln, pad, ty); ty += titleLH; });

    // body
    c.fillStyle = tpl.bodyColor;
    c.font = bodyFont;
    var by = ty + gap;
    bodyLines.forEach(function (ln) { c.fillText(ln, pad, by); by += bodyLH; });

    // ── footer: branding (bottom-left) ──
    var footY = H - pad - 56;
    var initial = (state.brandName.trim()[0] || 'S').toUpperCase();
    var r = 28;
    c.beginPath();
    c.arc(pad + r, footY + r, r, 0, Math.PI * 2);
    c.fillStyle = tpl.accentColor;
    c.fill();
    c.fillStyle = tpl.bg.type === 'solid' ? tpl.bg.color : '#0f172a';
    c.font = '700 30px ' + tpl.font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(initial, pad + r, footY + r + 1);

    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillStyle = tpl.brandColor;
    c.font = '700 30px ' + tpl.font;
    c.fillText(state.brandName, pad + r * 2 + 20, footY + 4);
    c.fillStyle = tpl.pageColor;
    c.font = '400 28px ' + tpl.font;
    c.fillText(state.brandHandle, pad + r * 2 + 20, footY + 36);

    // ── watermark (the growth loop) ──
    if (showWatermark) {
      c.textAlign = 'right';
      c.textBaseline = 'top';
      c.fillStyle = tpl.watermarkColor;
      c.font = '600 26px ' + tpl.font;
      c.fillText('Made with ' + BRAND, W - pad, footY + 20);
    }

    c.restore();
  }

  function showWatermark() { return !state.isPro; }

  // ── Preview + thumbnails ─────────────────────────────────────────────────────
  function renderPreview() {
    var tpl = effectiveTemplate();
    var slide = state.slides[state.current];
    paintSlide(ctx, slide, state.current, state.slides.length, tpl, showWatermark());
  }

  function renderThumbs() {
    var strip = $('thumbs');
    strip.innerHTML = '';
    var tpl = effectiveTemplate();
    state.slides.forEach(function (slide, i) {
      var t = document.createElement('canvas');
      t.width = W; t.height = H;
      t.className = 'thumb' + (i === state.current ? ' active' : '');
      paintSlide(t.getContext('2d'), slide, i, state.slides.length, tpl, showWatermark());
      var wrap = document.createElement('div');
      wrap.className = 'thumb-wrap' + (i === state.current ? ' active' : '');
      var num = document.createElement('span');
      num.className = 'thumb-num';
      num.textContent = i + 1;
      wrap.appendChild(t);
      wrap.appendChild(num);
      wrap.onclick = function () { go(i); };
      strip.appendChild(wrap);
    });
  }

  function renderTemplatePicker() {
    var box = $('templates');
    box.innerHTML = '';
    window.TEMPLATES.forEach(function (tpl) {
      var b = document.createElement('button');
      b.className = 'tpl-chip' + (tpl.id === state.templateId ? ' active' : '');
      b.innerHTML = '<span class="tpl-dot" style="background:' +
        (tpl.bg.type === 'gradient' ? tpl.bg.from : tpl.bg.color) +
        ';border-color:' + tpl.accentColor + '"></span>' + tpl.name +
        (tpl.pro ? '<span class="pro-tag">PRO</span>' : '');
      b.onclick = function () { state.templateId = tpl.id; sync(); };
      box.appendChild(b);
    });
  }

  // ── Sync everything from state ───────────────────────────────────────────────
  function syncInputs() {
    $('titleInput').value = state.slides[state.current].title;
    $('bodyInput').value = state.slides[state.current].body;
    $('brandName').value = state.brandName;
    $('brandHandle').value = state.brandHandle;
    $('slideLabel').textContent = 'Slide ' + (state.current + 1) + ' of ' + state.slides.length;
    Array.prototype.forEach.call(document.querySelectorAll('.size-btn'), function (b) {
      b.classList.toggle('active', b.dataset.size === state.textSize);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.fmt-btn'), function (b) {
      b.classList.toggle('active', b.dataset.fmt === state.format);
    });
    $('watermarkNote').style.display = state.isPro ? 'none' : 'flex';

    // custom brand colors (Pro)
    $('customToggle').checked = state.brand.custom;
    $('cBg').value = state.brand.bg;
    $('cText').value = state.brand.title;
    $('cAccent').value = state.brand.accent;
    var locked = !state.isPro;
    $('brandColors').classList.toggle('locked', locked);
    $('customToggle').disabled = locked;
    $('cBg').disabled = locked;
    $('cText').disabled = locked;
    $('cAccent').disabled = locked;
  }

  function sync() {
    renderPreview();
    renderThumbs();
    renderTemplatePicker();
    syncInputs();
    updateUsageUI();
    save();
  }

  function go(i) {
    state.current = Math.max(0, Math.min(i, state.slides.length - 1));
    sync();
  }

  // ── Slide ops ────────────────────────────────────────────────────────────────
  function addSlide() {
    state.slides.splice(state.current + 1, 0, { title: 'New slide', body: 'Add your point here.' });
    go(state.current + 1);
  }
  function deleteSlide() {
    if (state.slides.length <= 1) return;
    state.slides.splice(state.current, 1);
    go(Math.min(state.current, state.slides.length - 1));
  }
  function moveSlide(dir) {
    var j = state.current + dir;
    if (j < 0 || j >= state.slides.length) return;
    var tmp = state.slides[state.current];
    state.slides[state.current] = state.slides[j];
    state.slides[j] = tmp;
    go(j);
  }

  // ── Free-plan daily limit ────────────────────────────────────────────────────
  // NOTE: this is a soft, client-side cap (resettable by clearing the browser).
  // Real enforcement lands when Stripe + a tiny backend arrive. Good enough to
  // create upgrade pressure today.
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function getUsage() {
    try {
      var u = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
      if (u.date !== todayStr()) return { date: todayStr(), count: 0 };
      return { date: u.date, count: u.count || 0 };
    } catch (e) { return { date: todayStr(), count: 0 }; }
  }
  function exportsLeft() { return Math.max(0, FREE_DAILY_EXPORTS - getUsage().count); }
  function consumeExport() {
    if (state.isPro) return;
    var u = getUsage(); u.count += 1;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
    updateUsageUI();
  }
  function updateUsageUI() {
    var note = $('usageNote');
    if (!note) return;
    if (state.isPro) {
      note.textContent = '✦ Pro — unlimited downloads';
      note.className = 'usage pro';
      return;
    }
    var left = exportsLeft();
    note.className = 'usage' + (left === 0 ? ' empty' : '');
    note.textContent = left + ' of ' + FREE_DAILY_EXPORTS + ' free carousels left today';
  }

  // ── Upsell modal ─────────────────────────────────────────────────────────────
  function openUpsell(context) {
    var reason = $('upsellReason');
    if (context === 'limit') {
      reason.textContent = "You've used today's free carousels. Go Pro for unlimited downloads — no waiting until tomorrow.";
    } else if (context === 'theme') {
      reason.textContent = 'That’s a premium theme. Pro unlocks all 12 premium themes and removes the watermark.';
    } else if (context === 'brand') {
      reason.textContent = 'Custom brand colors are a Pro feature — paint your slides in your exact colors.';
    } else if (context === 'size') {
      reason.textContent = 'Square (1:1) export is a Pro size. Go Pro to post perfectly-sized graphics anywhere.';
    } else {
      reason.textContent = 'Unlock the full thing for the price of a coffee.';
    }
    $('upsellNote').textContent = '';
    $('upsell').classList.add('show');
  }
  function closeUpsell() { $('upsell').classList.remove('show'); }
  function setPro(on) {
    state.isPro = on;
    try {
      if (on) localStorage.setItem(PRO_KEY, '1');
      else localStorage.removeItem(PRO_KEY);
    } catch (e) {}
    updateUsageUI();
    sync();
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  function slideToBlob(i) {
    return new Promise(function (resolve) {
      var off = document.createElement('canvas');
      off.width = W; off.height = H;
      paintSlide(off.getContext('2d'), state.slides[i], i, state.slides.length,
        effectiveTemplate(), showWatermark());
      off.toBlob(function (b) { resolve(b); }, 'image/png');
    });
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // Returns true if export is allowed; otherwise opens the right upsell and returns false.
  function canExport() {
    if (state.isPro) return true;
    if (window.getTemplate(state.templateId).pro) { openUpsell('theme'); return false; }
    if (exportsLeft() <= 0) { openUpsell('limit'); return false; }
    return true;
  }
  function exportCurrent() {
    if (!canExport()) return;
    slideToBlob(state.current).then(function (b) {
      downloadBlob(b, 'swipely-slide-' + (state.current + 1) + '.png');
      consumeExport();
    });
  }
  function exportAll() {
    if (!canExport()) return;
    var btn = $('exportAll');
    btn.disabled = true; btn.textContent = 'Exporting…';
    var i = 0;
    (function next() {
      if (i >= state.slides.length) {
        btn.disabled = false; btn.textContent = 'Download all slides';
        consumeExport();   // one carousel = one use, regardless of slide count
        return;
      }
      slideToBlob(i).then(function (b) {
        downloadBlob(b, 'swipely-slide-' + (i + 1) + '.png');
        i++;
        setTimeout(next, 400); // small gap so browsers don't block the batch
      });
    })();
  }

  // ── Wire up ──────────────────────────────────────────────────────────────────
  function bind() {
    $('titleInput').addEventListener('input', function (e) {
      state.slides[state.current].title = e.target.value; renderPreview(); renderThumbs(); save();
    });
    $('bodyInput').addEventListener('input', function (e) {
      state.slides[state.current].body = e.target.value; renderPreview(); renderThumbs(); save();
    });
    $('brandName').addEventListener('input', function (e) {
      state.brandName = e.target.value; renderPreview(); renderThumbs(); save();
    });
    $('brandHandle').addEventListener('input', function (e) {
      state.brandHandle = e.target.value; renderPreview(); renderThumbs(); save();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.size-btn'), function (b) {
      b.addEventListener('click', function () { state.textSize = b.dataset.size; sync(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.fmt-btn'), function (b) {
      b.addEventListener('click', function () {
        var f = b.dataset.fmt;
        if (FORMATS[f].pro && !state.isPro) { openUpsell('size'); return; }
        state.format = f; applyFormat(); sync();
      });
    });
    // Custom brand colors (Pro). For free users, any interaction opens the upsell.
    $('brandColors').addEventListener('click', function (e) {
      if (!state.isPro) { e.preventDefault(); openUpsell('brand'); }
    }, true);
    $('customToggle').addEventListener('change', function (e) {
      state.brand.custom = e.target.checked; sync();
    });
    function bindColor(id, key) {
      $(id).addEventListener('input', function (e) {
        state.brand[key] = e.target.value;
        if (state.brand.custom) { renderPreview(); renderThumbs(); }
        save();
      });
    }
    bindColor('cBg', 'bg');
    bindColor('cText', 'title');
    bindColor('cAccent', 'accent');
    $('addSlide').addEventListener('click', addSlide);
    $('delSlide').addEventListener('click', deleteSlide);
    $('moveLeft').addEventListener('click', function () { moveSlide(-1); });
    $('moveRight').addEventListener('click', function () { moveSlide(1); });
    $('prevSlide').addEventListener('click', function () { go(state.current - 1); });
    $('nextSlide').addEventListener('click', function () { go(state.current + 1); });
    $('exportCurrent').addEventListener('click', exportCurrent);
    $('exportAll').addEventListener('click', exportAll);
    $('proBtn').addEventListener('click', function () { openUpsell(); });
    $('upsellClose').addEventListener('click', closeUpsell);
    $('upsell').addEventListener('click', function (e) {
      if (e.target === $('upsell')) closeUpsell(); // click the dimmed backdrop to close
    });
    $('upsellGetPro').addEventListener('click', function () {
      if (PRO_CHECKOUT_URL) {
        // Live checkout: hand off to Stripe. On success Stripe redirects back to
        // app.html?pro=success, which unlocks Pro on boot (see below).
        window.location.href = PRO_CHECKOUT_URL;
        return;
      }
      $('upsellNote').textContent = 'Checkout link isn’t connected yet (one 5-min Stripe step). Use “Preview Pro” below to try the Pro features now.';
    });
    $('upsellPreview').addEventListener('click', function () {
      setPro(true);
      closeUpsell();
    });
    $('resetBtn').addEventListener('click', function () {
      if (confirm('Start a fresh carousel? This clears your current slides.')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  load();

  // Returning from a successful Stripe checkout? Unlock Pro and clean the URL so
  // a refresh/bookmark doesn't re-trigger or leak the param.
  if (/[?&]pro=success/.test(location.search)) {
    setPro(true);
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  } else if (localStorage.getItem(PRO_KEY) === '1') {
    state.isPro = true; // restore a previously unlocked Pro session
  }

  // Don't let a free user inherit Pro-only settings from a past Pro-preview session.
  if (!state.isPro) {
    if ((FORMATS[state.format] || {}).pro) state.format = 'portrait';
    state.brand.custom = false;
  }
  applyFormat();
  bind();
  sync();
})();
