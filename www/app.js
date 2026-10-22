/* せかいタッチ — 地図をさわって世界の国を覚えるアプリ
 *
 *  さがす   : 地図を拡大・移動して国をタップ → 国旗・首都・面積・となりの国を見る
 *  場所あて : 「○○はどこ？」→ 地図の上でその国をタップして答える（2回までチャンス）
 *  きろく   : 国ごとの習熟度（☆0〜3）で地図をぬり分け、地域ごとの達成率を見る
 */
var App = (function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';

  /* ========== データ ========== */
  var REGION = ['', 'アジア', 'ヨーロッパ', 'アフリカ', '北中米', '南アメリカ', 'オセアニア'];
  var C = COUNTRY_DATA.map(function (r) {
    return { id: r[0], iso3: r[1], iso2: r[2], name: r[3], cap: r[4], reg: r[5], sub: r[6], area: r[7], adj: r[8],
      famous: !!r[9], onMap: !!r[10], note: r[11], d: r[12], c: r[13], b: r[14], ll: r[15] };
  });
  var byId = {}; C.forEach(function (c) { byId[c.id] = c; });
  var JAPAN_AREA = byId[192].area;
  C.forEach(function (c) {
    // 小さすぎて形をタップしにくい国は点で表示する
    c.dot = !c.d || !c.b || (c.b[2] - c.b[0]) * (c.b[3] - c.b[1]) < 3;
  });
  function flag(c) { return String.fromCodePoint.apply(null, c.iso2.split('').map(function (ch) { return 0x1F1E6 + ch.charCodeAt(0) - 65; })); }

  /* ========== 保存 ========== */
  var KEY = 'st_v1';
  function blank() { return { lv: {}, miss: {}, seen: {}, games: 0, right: 0, asked: 0, sound: true, names: true }; }
  var S;
  try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = blank(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function lv(id) { return S.lv[id] || 0; }

  /* ========== 音 ========== */
  var ac = null;
  function tone(f, d, type, v) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(v || 0.1, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
    } catch (e) {}
  }
  var sound = {
    tap: function () { tone(700, 0.05, 'triangle', 0.05); },
    ok: function () { tone(784, 0.09); setTimeout(function () { tone(1046, 0.14); }, 90); },
    ng: function () { tone(196, 0.2, 'square', 0.05); },
    end: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.12); }, i * 90); }); }
  };

  /* ========== UI部品 ========== */
  var UI = window.UI = {
    dialog: function (title, body, ok, cancel, okLabel) {
      $('dT').textContent = title; $('dB').textContent = body || '';
      var row = $('dR'); row.innerHTML = '';
      if (cancel) { var c = document.createElement('button'); c.className = 'btn sub'; c.textContent = 'キャンセル'; c.onclick = function () { $('dlg').classList.remove('on'); cancel(); }; row.appendChild(c); }
      var b = document.createElement('button'); b.className = 'btn'; b.textContent = okLabel || 'OK'; b.onclick = function () { $('dlg').classList.remove('on'); if (ok) ok(); }; row.appendChild(b);
      $('dlg').classList.add('on');
    }
  };
  var toastT = 0;
  function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('on'); }, 1800); }
  var fbT = 0;
  function feedback(t, kind, ms) { var e = $('fb'); e.textContent = t; e.className = 'fb on ' + (kind || ''); clearTimeout(fbT); fbT = setTimeout(function () { e.className = 'fb'; }, ms || 1600); }
  function km(n) { return n >= 1000 ? (Math.round(n / 100) * 100).toLocaleString() : String(Math.round(n / 10) * 10); }
  function areaText(a) {
    if (!a) return '0.44km²';
    if (a === JAPAN_AREA) return a.toLocaleString() + 'km²';
    var r = a / JAPAN_AREA;
    var x = r >= 10 ? Math.round(r) + '倍' : r >= 1 ? r.toFixed(1) + '倍' : r >= 0.01 ? Math.round(r * 100) + '%' : '1%未満';
    return a.toLocaleString() + 'km²（日本の' + x + '）';
  }

  /* ========== 地図 ========== */
  var svg, cam, labels, view = { k: 1, x: 0, y: 0 }, kMin = 1, kMax = 30;
  var shapes = {};   // id -> 要素（パス or 点）

  function buildMap() {
    svg = document.createElementNS(NS, 'svg');
    cam = document.createElementNS(NS, 'g');
    var other = document.createElementNS(NS, 'path'); other.setAttribute('class', 'o'); other.setAttribute('d', MAP_OTHER); cam.appendChild(other);
    var dots = document.createElementNS(NS, 'g');
    C.forEach(function (c) {
      if (c.d) {
        var p = document.createElementNS(NS, 'path'); p.setAttribute('class', 'c'); p.setAttribute('d', c.d); p.dataset.id = c.id; cam.appendChild(p);
        if (!c.dot) { shapes[c.id] = p; return; }
      }
      var o = document.createElementNS(NS, 'circle'); o.setAttribute('class', 'dot'); o.setAttribute('cx', c.c[0]); o.setAttribute('cy', c.c[1]); o.dataset.id = c.id;
      dots.appendChild(o); shapes[c.id] = o;
    });
    cam.appendChild(dots);
    labels = document.createElementNS(NS, 'g'); cam.appendChild(labels);
    svg.appendChild(cam); $('map').appendChild(svg);
    fitWorld(false);
    window.addEventListener('resize', function () { fitWorld(false); });
    bindGestures();
  }

  function screen() { return { w: window.innerWidth, h: window.innerHeight }; }
  function applyView() {
    cam.setAttribute('transform', 'translate(' + view.x.toFixed(1) + ',' + view.y.toFixed(1) + ') scale(' + view.k.toFixed(4) + ')');
    var r = 6 / view.k;
    for (var id in shapes) if (shapes[id].tagName === 'circle') shapes[id].setAttribute('r', r.toFixed(3));
    var fs = 12 / view.k;
    for (var i = 0; i < labels.childNodes.length; i++) { var t = labels.childNodes[i]; t.setAttribute('font-size', fs.toFixed(3)); t.style.strokeWidth = (3 / view.k) + 'px'; }
  }
  function clampView() {
    var s = screen(), w = MAP_W * view.k, h = MAP_H * view.k;
    view.k = Math.max(kMin, Math.min(kMax, view.k));
    w = MAP_W * view.k; h = MAP_H * view.k;
    var mx = s.w * 0.5, my = s.h * 0.5;
    view.x = w <= s.w ? (s.w - w) / 2 : Math.min(mx, Math.max(s.w - w - mx, view.x));
    view.y = h <= s.h ? (s.h - h) / 2 : Math.min(my, Math.max(s.h - h - my, view.y));
  }
  function fitWorld(anim) {
    var s = screen();
    kMin = Math.min(s.w / MAP_W, s.h / MAP_H) * 0.98;
    kMax = kMin * 40;
    flyToBox([0, 0, MAP_W, MAP_H], anim, 0);
  }
  // 地図上の範囲 [x0,y0,x1,y1] が、上下のUIを避けた場所に収まるように動かす
  var animId = 0;
  function flyToBox(b, anim, pad, maxK) {
    var s = screen(), top = 80, bottom = document.body.classList.contains('playing') ? 90 : 110;
    if (document.body.classList.contains('has-ad')) bottom += 56;
    if ($('sheet').classList.contains('on')) bottom = Math.max(bottom, s.h * 0.45);
    pad = pad == null ? 24 : pad;
    var bw = Math.max(b[2] - b[0], 4), bh = Math.max(b[3] - b[1], 4);
    var aw = s.w - pad * 2, ah = s.h - top - bottom - pad * 2;
    var k = Math.min(aw / bw, ah / bh);
    k = Math.max(kMin, Math.min(maxK || kMax * 0.5, k));
    var tx = s.w / 2 - (b[0] + bw / 2) * k, ty = top + pad + ah / 2 - (b[1] + bh / 2) * k;
    var from = { k: view.k, x: view.x, y: view.y }, to = { k: k, x: tx, y: ty };
    var id = ++animId;
    if (!anim) { view.k = k; view.x = tx; view.y = ty; clampView(); applyView(); return; }
    var t0 = performance.now(), dur = 420;
    (function step(t) {
      if (id !== animId) return;
      var p = Math.min(1, (t - t0) / dur), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      // 拡大率は対数で補間すると自然に見える
      view.k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      var cx = (s.w / 2 - from.x) / from.k + ((s.w / 2 - to.x) / to.k - (s.w / 2 - from.x) / from.k) * e;
      var cy = (s.h / 2 - from.y) / from.k + ((s.h / 2 - to.y) / to.k - (s.h / 2 - from.y) / from.k) * e;
      view.x = s.w / 2 - cx * view.k; view.y = s.h / 2 - cy * view.k;
      applyView();
      if (p < 1) requestAnimationFrame(step); else { view.k = to.k; view.x = to.x; view.y = to.y; clampView(); applyView(); }
    })(t0);
  }
  function zoomAt(f, sx, sy) {
    var k = Math.max(kMin, Math.min(kMax, view.k * f));
    view.x = sx - (sx - view.x) * (k / view.k); view.y = sy - (sy - view.y) * (k / view.k); view.k = k;
    clampView(); applyView();
  }
  function boxOf(ids) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    ids.forEach(function (id) {
      var c = byId[id], bb = c.b && !c.dot ? c.b : [c.c[0] - 3, c.c[1] - 3, c.c[0] + 3, c.c[1] + 3];
      // ロシアなど極端に大きい国は中心付近だけを見る
      if (c.iso3 === 'RUS') bb = [580, 90, 760, 230];
      b[0] = Math.min(b[0], bb[0]); b[1] = Math.min(b[1], bb[1]); b[2] = Math.max(b[2], bb[2]); b[3] = Math.max(b[3], bb[3]);
    });
    return b;
  }
  function boxAround(id, span) {
    var c = byId[id];
    var b = c.b && !c.dot ? c.b.slice() : [c.c[0], c.c[1], c.c[0], c.c[1]];
    if (c.iso3 === 'RUS') b = [520, 80, 900, 240];
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = Math.max(b[2] - b[0], span), h = Math.max(b[3] - b[1], span);
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }

  /* --- タッチ操作（1本指で移動・2本指で拡大・タップで選択） --- */
  var onTap = null;
  function bindGestures() {
    var el = $('map'), pts = {}, start = null, pinch = null, moved = 0;
    el.addEventListener('pointerdown', function (e) {
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      animId++;
      var n = Object.keys(pts).length;
      if (n === 1) { start = { x: e.clientX, y: e.clientY, t: performance.now(), vx: view.x, vy: view.y }; moved = 0; }
      if (n === 2) { var p = Object.values(pts); pinch = { d: dist(p[0], p[1]), k: view.k, m: mid(p[0], p[1]), vx: view.x, vy: view.y }; moved = 99; }
    });
    el.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = Object.values(pts);
      if (p.length >= 2 && pinch) {
        var m = mid(p[0], p[1]), k = Math.max(kMin, Math.min(kMax, pinch.k * dist(p[0], p[1]) / pinch.d));
        var mx = (pinch.m.x - pinch.vx) / pinch.k, my = (pinch.m.y - pinch.vy) / pinch.k;
        view.k = k; view.x = m.x - mx * k; view.y = m.y - my * k; clampView(); applyView();
      } else if (p.length === 1 && start) {
        var dx = e.clientX - start.x, dy = e.clientY - start.y;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (moved > 6) { view.x = start.vx + dx; view.y = start.vy + dy; clampView(); applyView(); }
      }
    });
    var end = function (e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      var n = Object.keys(pts).length;
      if (n === 1) { var p = Object.values(pts)[0]; start = { x: p.x, y: p.y, t: 0, vx: view.x, vy: view.y }; pinch = null; return; }
      if (n === 0) {
        pinch = null;
        if (start && moved <= 6 && performance.now() - start.t < 450 && e.type === 'pointerup') {
          var id = hit(e.clientX, e.clientY);
          if (onTap) onTap(id, e.clientX, e.clientY);
        }
        start = null;
      }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
    var lastTap = 0;
    el.addEventListener('pointerup', function (e) {
      var t = performance.now();
      if (t - lastTap < 280 && moved <= 6) zoomAt(2, e.clientX, e.clientY);
      lastTap = t;
    });
    $('zin').onclick = function () { var s = screen(); zoomAt(1.8, s.w / 2, s.h / 2); };
    $('zout').onclick = function () { var s = screen(); zoomAt(1 / 1.8, s.w / 2, s.h / 2); };
    $('zall').onclick = function () { fitWorld(true); };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  // 指の位置にある国。点の国は少し外れても拾う
  function hit(x, y) {
    var el = document.elementFromPoint(x, y);
    var id = el && el.dataset && el.dataset.id ? +el.dataset.id : null;
    if (id) return id;
    var best = null, bd = 18;
    C.forEach(function (c) {
      if (!c.dot) return;
      var sx = c.c[0] * view.k + view.x, sy = c.c[1] * view.k + view.y, d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = c.id; }
    });
    return best;
  }

  function paintLevels(on) {
    C.forEach(function (c) {
      var e = shapes[c.id], l = on ? lv(c.id) : 0;
      e.classList.remove('l1', 'l2', 'l3');
      if (l) e.classList.add('l' + l);
      // 点で出す国も、形があれば形のほうにも色を付ける
      if (c.d && c.dot) { var p = cam.querySelector('path[data-id="' + c.id + '"]'); if (p) { p.classList.remove('l1', 'l2', 'l3'); if (l) p.classList.add('l' + l); } }
    });
  }
  function mark(id, cls, on) {
    var e = shapes[id]; if (!e) return;
    e.classList.toggle(cls, on);
    var p = byId[id].dot && byId[id].d ? cam.querySelector('path[data-id="' + id + '"]') : null;
    if (p) p.classList.toggle(cls, on);
  }
  function clearMarks() {
    ['sel', 'ok', 'ng', 'goal', 'dim'].forEach(function (k) { cam.querySelectorAll('.' + k).forEach(function (e) { e.classList.remove(k); }); });
    labels.innerHTML = '';
  }
  function label(id, text) {
    var c = byId[id], t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'lbl'); t.setAttribute('x', c.c[0]); t.setAttribute('y', c.c[1] - (c.dot ? 10 / view.k : 0));
    t.textContent = text || c.name; labels.appendChild(t); applyView();
  }

  /* ========== 画面の切り替え ========== */
  var tab = 'explore';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    if (t === 'play') openSetup();
    else if (t === 'stats') openStats();
    else if (t === 'settings') openSettings();
    else { closePanel(); }
    updateAd();
  }
  function closePanel() { $('panel').classList.remove('on'); if (tab !== 'explore' && !game) { tab = 'explore'; document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === 'explore'); }); } updateAd(); }
  function panel(html) { $('pbox').innerHTML = html; $('panel').classList.add('on'); var x = $('pbox').querySelector('[data-close]'); if (x) x.onclick = function () { sound.tap(); closePanel(); paintLevels(true); clearMarks(); }; }
  $('panel').addEventListener('click', function (e) { if (e.target === $('panel') && !game) { closePanel(); clearMarks(); paintLevels(true); } });
  function updateAd() {
    var show = !game && !$('panel').classList.contains('on') && !Native.premium();
    Native.banner(show);
    document.body.classList.toggle('has-ad', show && Native.inApp);
  }
  function updateProgress() {
    var done = C.filter(function (c) { return lv(c.id) >= 3; }).length;
    $('prog').innerHTML = '覚えた <b>' + done + '</b>/' + C.length;
  }

  /* ========== さがす ========== */
  var selected = null;
  function select(id, fly) {
    clearMarks();
    selected = id;
    if (!id) { $('sheet').classList.remove('on'); return; }
    var c = byId[id];
    mark(id, 'sel', true); label(id);
    S.seen[id] = 1; save();
    var l = lv(id), stars = '★★★'.slice(0, l) + '<i>' + '★★★'.slice(l) + '</i>';
    var adj = c.adj.map(function (a) { return '<button data-go="' + a + '">' + byId[a].name + '</button>'; }).join('');
    $('sheet').innerHTML = '<button class="x" id="shx">✕</button>' +
      '<div class="kh"><div class="flag">' + flag(c) + '</div><div><div class="kn">' + c.name + '</div><div class="ks">' + REGION[c.reg] + '・' + c.sub + '　<span class="stars">' + stars + '</span></div></div></div>' +
      '<div class="kg"><div><span>首都</span><b>' + c.cap + '</b></div><div><span>面積</span><b style="font-size:13px">' + areaText(c.area) + '</b></div></div>' +
      (c.note ? '<div class="knote">※ ' + c.note + '</div>' : '') +
      '<div class="kadj">' + (c.adj.length ? '陸でとなりの国（' + c.adj.length + '）<br>' + adj : 'となりの国：陸の国境なし') + '</div>';
    $('sheet').classList.add('on');
    $('shx').onclick = function () { sound.tap(); select(null); };
    $('sheet').querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { sound.tap(); select(+b.dataset.go, true); }; });
    if (fly) flyToBox(boxAround(id, 40), true);
  }
  function exploreTap(id) {
    if (!id) { select(null); return; }
    sound.tap(); select(id, false);
  }
  // 国名さがし
  var kana = function (s) { return s.replace(/[ぁ-ゖ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) + 0x60); }); };
  $('q').addEventListener('input', function () {
    var v = kana($('q').value.trim()), box = $('sugg');
    if (!v) { box.classList.remove('on'); return; }
    var hits = C.filter(function (c) { return kana(c.name).indexOf(v) >= 0 || kana(c.cap).indexOf(v) >= 0; }).slice(0, 6);
    box.innerHTML = hits.map(function (c) { return '<div data-id="' + c.id + '">' + flag(c) + ' ' + c.name + '<span style="color:var(--sub);font-size:12px">　' + c.cap + '</span></div>'; }).join('') || '<div style="color:var(--sub)">見つかりません</div>';
    box.classList.add('on');
    box.querySelectorAll('[data-id]').forEach(function (d) { d.onclick = function () { $('q').value = ''; box.classList.remove('on'); $('q').blur(); select(+d.dataset.id, true); }; });
  });

  /* ========== 場所あて ========== */
  var AREAS = [
    { k: 0, n: '世界ぜんぶ', e: '🌏' }, { k: 1, n: 'アジア', e: '🏯' }, { k: 2, n: 'ヨーロッパ', e: '🏰' },
    { k: 3, n: 'アフリカ', e: '🦁' }, { k: 4, n: '北中米', e: '🗽' }, { k: 5, n: '南アメリカ', e: '🦜' }, { k: 6, n: 'オセアニア', e: '🐨' }
  ];
  var LEVELS = [{ k: 'easy', n: 'やさしい', d: 'よく聞く国' }, { k: 'map', n: 'ふつう', d: '地図で形が見える国' }, { k: 'all', n: 'ぜんぶ', d: '小さな島国もふくめて全部' }];
  var setup = { area: 0, level: 'easy' };
  try { Object.assign(setup, JSON.parse(localStorage.getItem('st_setup') || '{}')); } catch (e) {}
  function pool(area, level) {
    return C.filter(function (c) {
      if (area && c.reg !== area) return false;
      if (level === 'easy') return c.famous && !c.dot;
      if (level === 'map') return c.onMap || c.reg === 6;
      return true;
    });
  }
  function prog(list) { return list.length ? Math.round(list.reduce(function (a, c) { return a + lv(c.id); }, 0) / (list.length * 3) * 100) : 0; }
  function rate(list) { return list.length ? Math.round(list.filter(function (c) { return lv(c.id) >= 3; }).length / list.length * 100) : 0; }
  function openSetup() {
    var html = '<div class="ph"><h2>📍 場所あて</h2><button data-close>✕</button></div>' +
      '<p class="lead">「○○はどこ？」と聞かれたら、地図の上でその国をタップ。まちがえても、どっちの方向か教えてくれます。</p>' +
      '<div class="areas">' + AREAS.map(function (a) {
        var p = pool(a.k, 'all');
        return '<button class="area ' + (setup.area === a.k ? 'on' : '') + '" data-a="' + a.k + '"><b>' + a.e + ' ' + a.n + '</b><span>' + p.length + 'か国・覚えた ' + rate(p) + '%</span><div class="bar"><i style="width:' + prog(p) + '%"></i></div></button>';
      }).join('') + '</div>' +
      '<div class="seg">' + LEVELS.map(function (l) { return '<button data-l="' + l.k + '" class="' + (setup.level === l.k ? 'on' : '') + '">' + l.n + '</button>'; }).join('') + '</div>' +
      '<div class="cap" id="pinfo"></div>' +
      '<button class="btn" id="go">スタート</button>';
    panel(html);
    var info = function () { var n = pool(setup.area, setup.level).length, d = LEVELS.filter(function (l) { return l.k === setup.level; })[0].d; $('pinfo').textContent = d + '・' + n + 'か国から ' + Math.min(10, n) + '問'; };
    info();
    $('pbox').querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function () { sound.tap(); setup.area = +b.dataset.a; $('pbox').querySelectorAll('[data-a]').forEach(function (x) { x.classList.toggle('on', x === b); }); info(); }; });
    $('pbox').querySelectorAll('[data-l]').forEach(function (b) { b.onclick = function () { sound.tap(); setup.level = b.dataset.l; $('pbox').querySelectorAll('[data-l]').forEach(function (x) { x.classList.toggle('on', x === b); }); info(); }; });
    $('go').onclick = function () { sound.tap(); try { localStorage.setItem('st_setup', JSON.stringify(setup)); } catch (e) {} startGame(pool(setup.area, setup.level), null); };
  }

  var game = null;
  // 出題: 前にまちがえた国 → 習熟度が低い国 の順に優先して、ランダムに選ぶ
  function pick(list, n) {
    var scored = list.map(function (c) { return { c: c, s: (S.miss[c.id] ? 3 : 0) + (3 - lv(c.id)) + Math.random() * 2.5 }; });
    scored.sort(function (a, b) { return b.s - a.s; });
    var out = scored.slice(0, n).map(function (x) { return x.c.id; });
    for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  }
  function startGame(list, fixed) {
    closePanel(); select(null);
    var ids = fixed || pick(list, Math.min(10, list.length));
    game = { ids: ids, i: 0, tries: 0, score: 0, log: [], hints: 1, box: boxOf(list.map(function (c) { return c.id; })), lock: false };
    document.body.classList.add('playing');
    paintLevels(false);
    updateAd();
    Native.track('play_start', { area: setup.area, level: setup.level });
    flyToBox(game.box, true, 16);
    setTimeout(ask, 300);
  }
  function ask() {
    clearMarks();
    var c = byId[game.ids[game.i]];
    game.tries = 0; game.lock = false; game.hinted = false;
    // 前の問題で拡大していたら、出題範囲の全体に戻す
    if (game.i > 0) flyToBox(game.box, true, 16);
    $('ask').innerHTML = '<div class="flag">' + flag(c) + '</div><div class="q"><b>' + c.name + 'はどこ？</b><span>首都 ' + c.cap + '</span></div>' +
      '<div class="n">' + (game.i + 1) + ' / ' + game.ids.length + '</div><button class="quit" id="quit">✕</button>';
    $('quit').onclick = function () { sound.tap(); UI.dialog('やめますか？', 'ここまでの結果は、覚えた度合いには反映されています。', endGame.bind(null, true), function () {}, 'やめる'); };
    $('hintBtn').textContent = game.hints > 0 ? '💡 ヒント（あと' + game.hints + '回）' : '💡 ヒント（動画）';
    if (Native.premium()) $('hintBtn').textContent = '💡 ヒント';
  }
  // 方角(8方位)と距離
  function bearing(a, b) {
    var r = Math.PI / 180, la1 = a[1] * r, la2 = b[1] * r, dl = (b[0] - a[0]) * r;
    var y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    var deg = (Math.atan2(y, x) / r + 360) % 360;
    var d = Math.acos(Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl))) * 6371;
    return { dir: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round(deg / 45) % 8], km: d };
  }
  function playTap(id) {
    if (!game || game.lock || !id) return;
    var goal = game.ids[game.i];
    if (id === goal) {
      game.lock = true; sound.ok();
      var first = game.tries === 0;
      mark(id, 'ok', true); label(id);
      game.score += first ? 2 : 1;
      game.log.push({ id: id, r: first ? 2 : 1 });
      S.lv[id] = first && !game.hinted ? Math.min(3, lv(id) + 1) : Math.max(1, lv(id));
      if (first) delete S.miss[id];
      S.right++; S.asked++; save();
      feedback(first ? 'せいかい！' : 'せいかい！（2回目）', 'ok', 900);
      setTimeout(next, 950);
      return;
    }
    sound.ng(); game.tries++;
    mark(id, 'ng', true); label(id);
    var b = bearing(byId[id].ll, byId[goal].ll);
    if (game.tries < 2) {
      feedback('そこは' + byId[id].name + '。もっと ' + b.dir + ' へ約' + km(b.km) + 'km', 'ng', 2400);
      setTimeout(function () { if (game && byId[id]) { mark(id, 'ng', false); labels.innerHTML = ''; } }, 1500);
      return;
    }
    reveal(false);
  }
  function reveal(skipped) {
    var goal = game.ids[game.i];
    game.lock = true;
    game.log.push({ id: goal, r: 0 });
    S.lv[goal] = Math.max(0, lv(goal) - 1); S.miss[goal] = Date.now(); S.asked++; save();
    mark(goal, 'goal', true); label(goal);
    feedback(skipped ? byId[goal].name + 'はここ' : '正解は ' + byId[goal].name, 'ng', 2200);
    flyToBox(boxAround(goal, 60), true);
    setTimeout(function () { if (!game) return; next(); }, 2300);
  }
  function next() {
    if (!game) return;
    game.i++;
    if (game.i >= game.ids.length) { endGame(false); return; }
    ask();
  }
  $('skipBtn').onclick = function () { if (!game || game.lock) return; sound.tap(); reveal(true); };
  $('hintBtn').onclick = function () {
    if (!game || game.lock || game.hinted) return;
    sound.tap();
    var useHint = function () {
      game.hinted = true;
      var goal = byId[game.ids[game.i]];
      // 同じ小地域の国だけを残して、そのあたりに寄る
      var near = C.filter(function (c) { return c.sub === goal.sub; }).map(function (c) { return c.id; });
      C.forEach(function (c) { if (near.indexOf(c.id) < 0) mark(c.id, 'dim', true); });
      flyToBox(boxOf(near), true, 30, kMin * 12);
      feedback('ヒント：' + goal.sub + 'のどこか', '', 2200);
    };
    if (Native.premium()) { useHint(); return; }
    if (game.hints > 0) { game.hints--; useHint(); ask_refreshHint(); return; }
    Native.reward('ヒントを使う', '動画を見ると、ヒントが1回使えます。', useHint, function () {});
  };
  function ask_refreshHint() { $('hintBtn').textContent = game.hints > 0 ? '💡 ヒント（あと' + game.hints + '回）' : '💡 ヒント（動画）'; }

  function endGame(quit) {
    var g = game; game = null;
    document.body.classList.remove('playing');
    clearMarks(); paintLevels(true); updateProgress();
    S.games++; save();
    if (!g || !g.log.length) { fitWorld(true); updateAd(); return; }
    sound.end();
    Native.track('play_end', { score: g.score, n: g.log.length });
    var max = g.log.length * 2, missed = g.log.filter(function (x) { return !x.r; }).map(function (x) { return x.id; });
    var html = '<div class="ph"><h2>' + (quit ? 'ここまでの結果' : 'けっか') + '</h2><button data-close>✕</button></div>' +
      '<div class="big">' + g.score + '<small>/ ' + max + '点</small></div>' +
      '<div class="cap">◎ 1回で正解 2点 ・ ○ 2回目で正解 1点</div>' +
      '<div class="rlist">' + g.log.map(function (x) {
        var c = byId[x.id];
        return '<div>' + flag(c) + ' ' + c.name + '<span class="m ' + ['c', 'b', 'a'][x.r] + '">' + ['×', '○', '◎'][x.r] + '</span></div>';
      }).join('') + '</div>' +
      (missed.length ? '<button class="btn" id="again2">まちがえた ' + missed.length + 'か国をもう一度</button>' : '') +
      '<button class="btn' + (missed.length ? ' sub' : '') + '" id="again">つづけて場所あて</button>' +
      '<button class="btn sub" id="shr">結果をシェア</button>';
    panel(html);
    var after = function (fn) { if (S.games >= 3 && S.games % 3 === 0) Native.interstitial(fn); else fn(); };
    $('again').onclick = function () { sound.tap(); after(function () { startGame(pool(setup.area, setup.level), null); }); };
    if ($('again2')) $('again2').onclick = function () { sound.tap(); after(function () { startGame(missed.map(function (id) { return byId[id]; }), missed); }); };
    $('shr').onclick = function () {
      var done = C.filter(function (c) { return lv(c.id) >= 3; }).length;
      Native.share('せかいタッチで場所あて ' + g.score + '/' + max + '点！\n' + g.log.map(function (x) { return ['❌', '🟡', '🟢'][x.r]; }).join('') + '\n世界の国 ' + done + '/' + C.length + 'か国 覚えた');
    };
    fitWorld(true);
    updateAd();
  }

  /* ========== きろく ========== */
  function openStats() {
    select(null); paintLevels(true); fitWorld(true);
    var count = [0, 0, 0, 0]; C.forEach(function (c) { count[lv(c.id)]++; });
    var weak = Object.keys(S.miss).map(Number).sort(function (a, b) { return S.miss[b] - S.miss[a]; }).slice(0, 12);
    var html = '<div class="ph"><h2>📊 きろく</h2><button data-close>✕</button></div>' +
      '<div class="legend"><span><i style="background:var(--land)"></i>まだ ' + count[0] + '</span><span><i style="background:var(--l1)"></i>☆1 ' + count[1] + '</span><span><i style="background:var(--l2)"></i>☆2 ' + count[2] + '</span><span><i style="background:var(--l3)"></i>覚えた ' + count[3] + '</span></div>' +
      AREAS.slice(1).map(function (a) { var p = pool(a.k, 'all'), r = prog(p); return '<div class="reg"><b>' + a.e + ' ' + a.n + '</b><div class="bar"><i style="width:' + r + '%"></i></div><span>' + p.filter(function (c) { return lv(c.id) >= 3; }).length + '/' + p.length + '</span></div>'; }).join('') +
      '<div class="cap" style="margin-top:10px">場所あて ' + S.games + '回 ・ 正解率 ' + (S.asked ? Math.round(S.right / S.asked * 100) : 0) + '% ・ 見た国 ' + Object.keys(S.seen).length + '</div>' +
      (weak.length ? '<div class="sec">にがてな国（タップで地図へ）</div><div class="list">' + weak.map(function (id) { var c = byId[id]; return '<a class="item" data-id="' + id + '">' + flag(c) + ' ' + c.name + '<span>' + c.sub + ' ›</span></a>'; }).join('') + '</div>' : '') +
      '<p class="foot">地図の色は、そのまま覚えた度合いです。場所あてで1回で正解すると☆が1つ増え、3つで「覚えた」になります。</p>' +
      '<button class="btn sub" data-close2>地図を見る</button>';
    panel(html);
    $('pbox').querySelectorAll('.item[data-id]').forEach(function (a) { a.onclick = function () { closePanel(); select(+a.dataset.id, true); }; });
    $('pbox').querySelector('[data-close2]').onclick = function () { closePanel(); };
  }

  /* ========== 設定 ========== */
  function openSettings() {
    var html = '<div class="ph"><h2>⚙️ 設定</h2><button data-close>✕</button></div>' +
      '<div class="list"><div class="item" id="sSound">効果音<div class="sw ' + (S.sound ? 'on' : '') + '"></div></div></div>' +
      '<div class="sec">広告なし</div><div class="list">' +
      '<div class="item" id="sBuy">広告なし＋ヒント使い放題<span>' + (Native.premium() ? '購入済み' : '¥300（買い切り） ›') + '</span></div>' +
      '<div class="item" id="sRestore">購入を復元<span>›</span></div></div>' +
      '<div class="sec">このアプリについて</div><div class="list">' +
      '<a class="item" href="https://pochitto356.github.io/pochittosekai-privacy.html" target="_blank" rel="noopener">プライバシーポリシー<span>›</span></a>' +
      '<a class="item" href="https://pochitto356.github.io/policies/support/" target="_blank" rel="noopener">サポート・お問い合わせ<span>›</span></a>' +
      '<div class="item" id="sReset" style="color:var(--bad)">記録をリセット<span>›</span></div></div>' +
      '<p class="foot">地図データ：Natural Earth（パブリックドメイン）<br>国境・国名の表示は学習用の目安で、特定の立場を示すものではありません。<br>せかいタッチ v1.0.0 ・ pochitto games</p>';
    panel(html);
    $('sSound').onclick = function () { S.sound = !S.sound; save(); openSettings(); sound.tap(); };
    $('sBuy').onclick = function () { if (!Native.premium()) Native.buy(); };
    $('sRestore').onclick = function () { Native.restore(); };
    $('sReset').onclick = function () { UI.dialog('記録をリセット', '覚えた度合いと記録をすべて消します。購入は消えません。', function () { var keep = S.sound; S = blank(); S.sound = keep; save(); paintLevels(true); updateProgress(); toast('リセットしました'); }, function () {}, 'リセット'); };
  }

  /* ========== 起動 ========== */
  function onPremium(on) { if (on) toast('広告を消しました。ありがとうございます！'); updateAd(); if (tab === 'settings') openSettings(); }
  function init() {
    buildMap();
    paintLevels(true); updateProgress();
    onTap = function (id) { if (game) playTap(id); else exploreTap(id); };
    document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { sound.tap(); setTab(b.dataset.tab); }; });
    $('q').addEventListener('focus', function () { select(null); });
    // 最初は日本のあたりから
    flyToBox(boxAround(192, 260), false);
    updateAd();
    Native.start().then(updateAd);
  }

  return { init: init, onPremium: onPremium, _s: function () { return S; }, _g: function () { return game; }, _byId: byId };
})();
App.init();
