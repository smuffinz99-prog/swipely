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
  var FREE_DAILY_EXPORTS = 2;     // free plan: carousels (downloads) per day before Pro
  var PRO_PRICE = '$6';           // Pro price, shown in the upsell + watermark note
  var PRO_KEY = 'swipely.pro.v1'; // persisted Pro flag (survives reloads, separate from project)

  // ── Checkout (Stripe Payment Link) ───────────────────────────────────────────
  // To go live: in the Stripe Dashboard create a Payment Link for the $6/mo Pro
  // subscription, set its post-payment redirect to:  <your-domain>/app.html?pro=success
  // then paste the link URL below. Until then, "Get Pro" falls back to Preview.
  // This is the only step that needs the account owner — ~5 minutes, no code.
  var PRO_CHECKOUT_URL = 'https://buy.stripe.com/test_28E4gy7r79Tw0Az9zbb3q00';

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
    if (tpl.overlay === 'damask')     { overlayDamask(c, col); }
    if (tpl.overlay === 'baroque')    { overlayBaroque(c, col); }
    if (tpl.overlay === 'art-deco')   { overlayArtDeco(c, col); }
    if (tpl.overlay === 'cathedral')  { overlayCathedral(c, col); }
    if (tpl.overlay === 'manuscript') { overlayManuscript(c, col); }
    c.restore();
  }

  function overlayDamask(c, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.globalAlpha = 0.11;
    var s = 140;
    for (var row = -1; row <= Math.ceil(H / s) + 1; row++) {
      for (var col2 = -1; col2 <= Math.ceil(W / s) + 1; col2++) {
        var ox = (Math.abs(row) % 2 === 1) ? s / 2 : 0;
        damaskTile(c, col2 * s + ox, row * s, s);
      }
    }
  }
  function damaskTile(c, cx, cy, s) {
    var r = s * 0.3;
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.quadraticCurveTo(cx + r * 0.65, cy - r * 0.65, cx + r * 0.72, cy);
    c.quadraticCurveTo(cx + r * 0.65, cy + r * 0.65, cx, cy + r);
    c.quadraticCurveTo(cx - r * 0.65, cy + r * 0.65, cx - r * 0.72, cy);
    c.quadraticCurveTo(cx - r * 0.65, cy - r * 0.65, cx, cy - r);
    c.closePath(); c.stroke();
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(function (a) {
      c.beginPath();
      c.ellipse(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3, r * 0.3, r * 0.13, a, 0, Math.PI * 2);
      c.stroke();
    });
    c.beginPath(); c.arc(cx, cy, r * 0.11, 0, Math.PI * 2); c.fill();
    [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4].forEach(function (a) {
      c.beginPath(); c.arc(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, 3.5, 0, Math.PI * 2); c.fill();
    });
  }

  function overlayBaroque(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var m = 65;
    c.globalAlpha = 0.30; c.lineWidth = 3;
    c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.15; c.lineWidth = 1.5;
    c.strokeRect(m + 18, m + 18, W - m * 2 - 36, H - m * 2 - 36);
    c.globalAlpha = 0.35; c.lineWidth = 2.5;
    [[m, m, 0], [W - m, m, Math.PI / 2], [W - m, H - m, Math.PI], [m, H - m, Math.PI * 3 / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); c.rotate(pt[2]); baroqueCorner(c, 110); c.restore();
    });
    c.globalAlpha = 0.20;
    var sp = 80, n = Math.ceil((W - m * 2) / sp);
    for (var i = 1; i < n; i++) {
      var bx = m + i * (W - m * 2) / n;
      c.beginPath(); c.arc(bx, m, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(bx, H - m, 5, 0, Math.PI * 2); c.fill();
    }
    var ns = Math.ceil((H - m * 2) / sp);
    for (var j = 1; j < ns; j++) {
      var by = m + j * (H - m * 2) / ns;
      c.beginPath(); c.arc(m, by, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(W - m, by, 5, 0, Math.PI * 2); c.fill();
    }
  }
  function baroqueCorner(c, sz) {
    c.beginPath();
    c.moveTo(20, 0);
    c.bezierCurveTo(sz * 0.4, -15, sz * 0.7, -10, sz * 0.9, 5);
    c.bezierCurveTo(sz * 1.05, 18, sz * 0.85, 35, sz * 0.65, 25);
    c.bezierCurveTo(sz * 0.45, 15, sz * 0.55, -5, sz * 0.75, -8);
    c.stroke();
    c.beginPath();
    c.moveTo(0, 20);
    c.bezierCurveTo(-15, sz * 0.4, -10, sz * 0.7, 5, sz * 0.9);
    c.bezierCurveTo(18, sz * 1.05, 35, sz * 0.85, 25, sz * 0.65);
    c.bezierCurveTo(15, sz * 0.45, -5, sz * 0.55, -8, sz * 0.75);
    c.stroke();
    c.beginPath();
    c.moveTo(25, 25);
    c.bezierCurveTo(sz * 0.35, sz * 0.2, sz * 0.55, sz * 0.35, sz * 0.45, sz * 0.55);
    c.bezierCurveTo(sz * 0.35, sz * 0.75, sz * 0.2, sz * 0.65, sz * 0.3, sz * 0.45);
    c.stroke();
    [[8, 0], [16, 0], [24, 0], [0, 8], [0, 16], [0, 24]].forEach(function (d) {
      c.beginPath(); c.arc(d[0], d[1], 3, 0, Math.PI * 2); c.fill();
    });
  }

  function overlayArtDeco(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var fx = W / 2, fy = H + 80;
    c.globalAlpha = 0.12; c.lineWidth = 1.5;
    for (var i = 0; i < 36; i++) {
      var a = -Math.PI + (Math.PI * i / 35);
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(a) * H * 1.4, fy + Math.sin(a) * H * 1.4); c.stroke();
    }
    c.globalAlpha = 0.09;
    [250, 500, 750, 1000, 1250].forEach(function (r) {
      c.beginPath(); c.arc(fx, fy, r, -Math.PI, 0); c.stroke();
    });
    var m = 75;
    c.globalAlpha = 0.28; c.lineWidth = 3; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.14; c.lineWidth = 1.5; c.strokeRect(m + 20, m + 20, W - m * 2 - 40, H - m * 2 - 40);
    c.globalAlpha = 0.32; c.lineWidth = 2.5;
    [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]].forEach(function (pt) {
      var x = pt[0], y = pt[1], sx = pt[2], sy = pt[3], sz = 65;
      c.beginPath(); c.moveTo(x + sx * sz, y); c.lineTo(x, y); c.lineTo(x, y + sy * sz); c.stroke();
      c.beginPath(); c.moveTo(x + sx * sz * 0.55, y + sy * 18); c.lineTo(x + sx * 18, y + sy * 18); c.lineTo(x + sx * 18, y + sy * sz * 0.55); c.stroke();
      c.beginPath(); c.moveTo(x + sx * 35, y); c.lineTo(x + sx * 50, y + sy * 15); c.lineTo(x + sx * 35, y + sy * 30); c.lineTo(x + sx * 20, y + sy * 15); c.closePath(); c.stroke();
    });
  }

  function overlayCathedral(c, col) {
    c.fillStyle = col; c.strokeStyle = col;
    var archW = 180, archH = 380;
    c.globalAlpha = 0.13;
    for (var i = -1; i < Math.ceil(W / archW) + 2; i++) {
      gothicArch(c, i * archW + archW / 2, H, archW * 0.88, archH, true);
    }
    c.globalAlpha = 0.07;
    for (var j = -1; j < Math.ceil(W / 90) + 2; j++) {
      gothicArch(c, j * 90 + 45, H - archH + 190, 79, 190, false);
    }
    var m = 70;
    c.globalAlpha = 0.22; c.lineWidth = 3; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.11; c.lineWidth = 1.5; c.strokeRect(m + 16, m + 16, W - m * 2 - 32, H - m * 2 - 32);
    var rcx = W / 2, rcy = 270, rr = 115;
    c.globalAlpha = 0.16; c.lineWidth = 2;
    c.beginPath(); c.arc(rcx, rcy, rr, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(rcx, rcy, rr * 0.64, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(rcx, rcy, rr * 0.24, 0, Math.PI * 2); c.stroke();
    for (var k = 0; k < 8; k++) {
      var sa = k * Math.PI / 4;
      c.beginPath();
      c.moveTo(rcx + Math.cos(sa) * rr * 0.24, rcy + Math.sin(sa) * rr * 0.24);
      c.lineTo(rcx + Math.cos(sa) * rr * 0.64, rcy + Math.sin(sa) * rr * 0.64);
      c.stroke();
      c.beginPath(); c.arc(rcx + Math.cos(sa) * rr * 0.84, rcy + Math.sin(sa) * rr * 0.84, rr * 0.17, 0, Math.PI * 2); c.stroke();
    }
  }
  function gothicArch(c, cx, base, w, h, fill) {
    var hw = w / 2;
    c.beginPath();
    c.moveTo(cx - hw, base); c.lineTo(cx - hw, base - h * 0.4);
    c.bezierCurveTo(cx - hw, base - h * 0.85, cx - hw * 0.08, base - h, cx, base - h);
    c.bezierCurveTo(cx + hw * 0.08, base - h, cx + hw, base - h * 0.85, cx + hw, base - h * 0.4);
    c.lineTo(cx + hw, base); c.closePath();
    if (fill) c.fill(); else c.stroke();
  }

  function overlayManuscript(c, col) {
    c.strokeStyle = col; c.fillStyle = col;
    var m = 55;
    c.globalAlpha = 0.40; c.lineWidth = 3.5; c.strokeRect(m, m, W - m * 2, H - m * 2);
    c.globalAlpha = 0.18; c.lineWidth = 1; c.strokeRect(m + 15, m + 15, W - m * 2 - 30, H - m * 2 - 30);
    c.globalAlpha = 0.10; c.strokeRect(m + 28, m + 28, W - m * 2 - 56, H - m * 2 - 56);
    c.globalAlpha = 0.35; c.lineWidth = 2;
    [[m, m, 0], [W - m, m, Math.PI / 2], [W - m, H - m, Math.PI], [m, H - m, Math.PI * 3 / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); c.rotate(pt[2]); manuscriptCorner(c, 80); c.restore();
    });
    c.globalAlpha = 0.30;
    [[W / 2, m], [W / 2, H - m], [m, H / 2], [W - m, H / 2]].forEach(function (pt) {
      c.save(); c.translate(pt[0], pt[1]); manuscriptDiamond(c, 13); c.restore();
    });
  }
  function manuscriptCorner(c, sz) {
    c.beginPath(); c.moveTo(sz, 0); c.lineTo(0, 0); c.lineTo(0, sz); c.stroke();
    c.beginPath();
    c.moveTo(sz * 0.5, 0); c.lineTo(sz * 0.5, sz * 0.18);
    c.lineTo(sz * 0.18, sz * 0.18); c.lineTo(sz * 0.18, sz * 0.5); c.lineTo(0, sz * 0.5);
    c.stroke();
    c.beginPath();
    c.moveTo(0, sz * 0.08); c.lineTo(sz * 0.08, 0); c.lineTo(sz * 0.16, sz * 0.08); c.lineTo(sz * 0.08, sz * 0.16); c.closePath(); c.stroke();
    [sz * 0.35, sz * 0.6, sz * 0.82].forEach(function (d) {
      c.beginPath(); c.arc(d, -1, 3.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(-1, d, 3.5, 0, Math.PI * 2); c.fill();
    });
  }
  function manuscriptDiamond(c, r) {
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.7, 0); c.lineTo(0, r); c.lineTo(-r * 0.7, 0); c.closePath(); c.fill();
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
