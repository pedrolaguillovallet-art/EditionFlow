/* timeline.js: linea de tiempo (regla, secciones, planos, forma de onda), zoom e interaccion. */
(function () {
  "use strict";
  var PV = (window.PV = window.PV || {});
  var $ = function (id) { return document.getElementById(id); };
  var scroll = $("tl-scroll"), inner = $("tl-inner"), rowRuler = $("row-ruler"), rowSecs = $("row-secs"),
    rowShots = $("row-shots"), rowWave = $("row-wave"), beatsEl = $("beats"), playhead = $("playhead"),
    canvas = $("wave-canvas"), hint = $("wave-hint"), zoom = $("zoom"), tip = $("tl-tip");
  var WAVE_H = 80, atFit = true, lastWaveKey = "", lastDragEnd = 0;
  var h = PV.h;
  PV.pps = 10;

  function dur() { return PV.project.duration; }
  function fitPps() { return Math.max(0.01, (scroll.clientWidth - 2) / dur()); }
  function maxPps(mn) { return Math.max(mn, Math.min(200, 30000 / dur())); }

  function setPps(p) {
    var mn = fitPps(), mx = maxPps(mn);
    p = PV.clamp(p, mn, mx);
    atFit = p <= mn * 1.000001;
    PV.pps = p;
    zoom.value = mx > mn ? Math.round(1000 * Math.log(p / mn) / Math.log(mx / mn)) : 0;
  }
  function zoomAt(p, anchor) {
    var tAt = (scroll.scrollLeft + anchor) / PV.pps;
    setPps(p);
    renderAll({});
    scroll.scrollLeft = tAt * PV.pps - anchor;
  }
  function timeAt(clientX) { return (clientX - inner.getBoundingClientRect().left) / PV.pps; }
  function fmtMin(t) {
    var s = Math.floor(t + 1e-6), m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  /* ---------- regla y rejilla de tiempos ---------- */
  function renderGrid() {
    var d = dur(), pps = PV.pps, p = PV.project, step = 60;
    [1, 2, 5, 10, 15, 30, 60].some(function (s) { if (s * pps >= 70) { step = s; return true; } return false; });
    var frag = document.createDocumentFragment();
    for (var k = 0; k * step <= d + 1e-9; k++) {
      var x = k * step * pps;
      var tick = h("div", "rtick");
      tick.style.left = x + "px";
      frag.appendChild(tick);
      var lb = h("div", "rlbl", fmtMin(k * step));
      lb.style.left = x + "px";
      frag.appendChild(lb);
    }
    rowRuler.textContent = "";
    rowRuler.appendChild(frag);

    beatsEl.textContent = "";
    if (p.bpm > 0) {
      var bstep = 60 / p.bpm, bf = document.createDocumentFragment();
      if (bstep * pps >= 6 && d / bstep <= 4000) {
        for (var kb = Math.ceil(-p.beatOffset / bstep); ; kb++) {
          var bt = p.beatOffset + kb * bstep;
          if (bt > d) break;
          if (bt < 0) continue;
          var line = h("div", ((kb % 4) + 4) % 4 === 0 ? "beat bar" : "beat");
          line.style.left = bt * pps + "px";
          bf.appendChild(line);
        }
        beatsEl.appendChild(bf);
      }
    }
  }

  /* ---------- forma de onda ---------- */
  function drawWave(force) {
    var key = PV.pps.toFixed(4) + "|" + dur().toFixed(3) + "|" + (PV.peaks ? PV.peaks.length : 0);
    if (!force && key === lastWaveKey) return;
    lastWaveKey = key;
    if (!PV.peaks) {
      canvas.style.display = "none";
      hint.style.display = "flex";
      return;
    }
    hint.style.display = "none";
    canvas.style.display = "block";
    var W = Math.max(1, Math.ceil(dur() * PV.pps)), H = WAVE_H, pk = PV.peaks, n = pk.length, pps = PV.pps;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#5b6578";
    var mid = H / 2, amp = H / 2 - 4, mx = PV.peakMax || 1;
    for (var x = 0; x < W; x++) {
      var a = Math.floor(x * 100 / pps), b = Math.max(a + 1, Math.floor((x + 1) * 100 / pps)), m = 0;
      for (var i = a; i < b && i < n; i++) if (pk[i] > m) m = pk[i];
      var hh = Math.max(1, (m / mx) * amp);
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }

  /* ---------- bloques de secciones y planos ---------- */
  function makeBlock(kind) {
    var node = h("div", "blk");
    node.dataset.kind = kind;
    node.appendChild(h("div", "handle"));
    node.appendChild(h("div", "blk-body"));
    return node;
  }
  function updateBlock(node, it, i, list, kind) {
    var end = PV.itemEnd(list, i), pps = PV.pps;
    node.style.left = it.start * pps + "px";
    node.style.width = Math.max(1, (end - it.start) * pps) + "px";
    node.firstChild.style.display = i === 0 ? "none" : "";
    var body = node.lastChild;
    body.textContent = "";
    if (kind === "section") {
      node.style.background = PV.sectionColor(it);
      body.textContent = PV.sectionLabel(it);
      return;
    }
    node.style.borderLeftColor = PV.categoryColor(it.category);
    var img = PV.validImage(it.image);
    node.style.backgroundImage = img ? 'linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.8)), url("' + img + '")' : "";
    node.classList.toggle("has-img", !!img);
    var top = h("div", "blk-top");
    top.appendChild(h("b", "", String(i + 1)));
    var ab = PV.SHOT_ABBR[it.shotType];
    if (ab) top.appendChild(document.createTextNode(" · " + ab));
    if (it.done) top.appendChild(document.createTextNode(" ✓"));
    body.appendChild(top);
    body.appendChild(h("div", "blk-desc", it.description || ""));
  }
  function syncRow(row, list, kind) {
    var map = {}, c;
    for (c = 0; c < row.children.length; c++) {
      var ch = row.children[c];
      if (ch.classList.contains("blk")) map[ch.dataset.id] = ch;
    }
    var seen = {};
    list.forEach(function (it, i) {
      var node = map[it.id];
      if (!node) {
        node = makeBlock(kind);
        node.dataset.id = it.id;
        row.appendChild(node);
      }
      seen[it.id] = true;
      updateBlock(node, it, i, list, kind);
    });
    Object.keys(map).forEach(function (id) { if (!seen[id]) map[id].remove(); });
  }
  function applySelection() {
    var s = PV.selection;
    [rowSecs, rowShots].forEach(function (row) {
      for (var c = 0; c < row.children.length; c++) {
        var n = row.children[c];
        n.classList.toggle("sel", s.kind === n.dataset.kind && s.id === n.dataset.id);
      }
    });
  }
  function renderAll(data) {
    if (!PV.project) return;
    if (atFit) setPps(fitPps()); else setPps(PV.pps);
    inner.style.width = Math.ceil(dur() * PV.pps) + "px";
    if (!data || !data.light) renderGrid();
    syncRow(rowSecs, PV.project.sections, "section");
    syncRow(rowShots, PV.project.shots, "shot");
    drawWave(false);
    applySelection();
    updatePlayhead();
  }

  /* ---------- cabezal y seguimiento ---------- */
  function updatePlayhead() { playhead.style.transform = "translateX(" + PV.time * PV.pps + "px)"; }
  function follow() {
    var x = PV.time * PV.pps, W = scroll.clientWidth, L = scroll.scrollLeft;
    if (x > L + W * 0.85 || x < L) scroll.scrollLeft = Math.max(0, x - W * 0.15);
  }
  PV.ensureVisible = function (t) {
    var x = t * PV.pps, W = scroll.clientWidth, L = scroll.scrollLeft;
    if (x < L || x > L + W - 40) scroll.scrollLeft = Math.max(0, x - W * 0.15);
  };

  /* ---------- ajuste al arrastrar ---------- */
  PV.snapTime = function (t, excludeTrack, tolSec) {
    var p = PV.project, best = t, bestD = tolSec != null ? tolSec : 8 / PV.pps;
    function consider(c) {
      var d = Math.abs(c - t);
      if (d <= bestD) { bestD = d; best = c; }
    }
    if (p.bpm > 0) consider(PV.nearestBeat(t));
    (excludeTrack === "shots" ? p.sections : p.shots).forEach(function (it) { consider(it.start); });
    consider(PV.time);
    return best;
  };

  /* ---------- interaccion ---------- */
  function scrubRow(e, row) {
    row.setPointerCapture(e.pointerId);
    PV.seek(timeAt(e.clientX));
    var mv = function (ev) { PV.seek(timeAt(ev.clientX)); };
    var up = function () {
      row.removeEventListener("pointermove", mv);
      row.removeEventListener("pointerup", up);
      row.removeEventListener("pointercancel", up);
    };
    row.addEventListener("pointermove", mv);
    row.addEventListener("pointerup", up);
    row.addEventListener("pointercancel", up);
  }
  function showTip(x, y, text) {
    tip.textContent = text;
    tip.style.display = "block";
    tip.style.left = x + 12 + "px";
    tip.style.top = y - 30 + "px";
  }
  function hideTip() { tip.style.display = "none"; }

  // Arrastre de la frontera (borde izquierdo) de un item.
  function dragBoundary(e, track) {
    var handle = e.target, id = handle.parentElement.dataset.id;
    var i0 = PV.indexById(PV.project[track], id);
    if (i0 <= 0) return;
    e.preventDefault();
    var startX = e.clientX, orig = PV.project[track][i0].start, last = orig, moved = false;
    PV.pushUndo();
    handle.setPointerCapture(e.pointerId);
    showTip(e.clientX, e.clientY, PV.fmtTime(orig));
    var mv = function (ev) {
      var p = PV.project, cur = p[track], i = PV.indexById(cur, id);
      if (i <= 0) return;
      var t = orig + (ev.clientX - startX) / PV.pps;
      if (p.snap && !ev.altKey) t = PV.snapTime(t, track);
      var lo = cur[i - 1].start + 0.2;
      var hi = (i + 1 < cur.length ? cur[i + 1].start : p.duration) - 0.2;
      t = PV.clamp(t, lo, Math.max(lo, hi));
      if (Math.abs(t - last) > 1e-6) { moved = true; last = t; }
      PV.mutateSilently(function (pp) {
        var k = PV.indexById(pp[track], id);
        if (k > 0) pp[track][k].start = t;
      });
      showTip(ev.clientX, ev.clientY, PV.fmtTime(t));
    };
    var up = function () {
      handle.removeEventListener("pointermove", mv);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      hideTip();
      lastDragEnd = Date.now();
      if (!moved) PV.undoStack.pop();
      PV.finishChange({});
    };
    handle.addEventListener("pointermove", mv);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function bindRow(row, kind) {
    row.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || !PV.project) return;
      if (e.target.classList.contains("handle")) {
        dragBoundary(e, kind === "sec" ? "sections" : "shots");
      } else if (kind === "ruler" || kind === "wave") {
        scrubRow(e, row);
      }
    });
  }
  function bindBlocks(row, kind) {
    var track = kind === "section" ? "sections" : "shots";
    row.addEventListener("click", function (e) {
      if (!PV.project || Date.now() - lastDragEnd < 300) return;
      var node = e.target.closest(".blk");
      if (!node || e.target.classList.contains("handle")) return;
      var list = PV.project[track], i = PV.indexById(list, node.dataset.id);
      if (i < 0) return;
      PV.select(kind, node.dataset.id);
      PV.seek(list[i].start);
    });
    row.addEventListener("dblclick", function (e) {
      if (!PV.project || e.target.classList.contains("handle")) return;
      var t = timeAt(e.clientX);
      if (PV.project.snap && !e.altKey) t = PV.snapTime(t, track);
      var it = PV.cut(track, t);
      if (it) PV.select(kind, it.id);
    });
  }

  bindRow(rowRuler, "ruler");
  bindRow(rowWave, "wave");
  bindRow(rowSecs, "sec");
  bindRow(rowShots, "shot");
  bindBlocks(rowSecs, "section");
  bindBlocks(rowShots, "shot");

  zoom.addEventListener("input", function () {
    if (!PV.project) return;
    var mn = fitPps(), mx = maxPps(mn);
    zoomAt(mn * Math.pow(mx / mn, zoom.value / 1000), scroll.clientWidth / 2);
  });
  scroll.addEventListener("wheel", function (e) {
    if (!e.ctrlKey || !PV.project) return;
    e.preventDefault();
    zoomAt(PV.pps * Math.exp(-e.deltaY * 0.002), e.clientX - scroll.getBoundingClientRect().left);
  }, { passive: false });
  window.addEventListener("resize", function () { renderAll({}); });

  PV.on("change", renderAll);
  PV.on("audio", function () { drawWave(true); });
  PV.on("select", applySelection);
  PV.on("time", function () {
    updatePlayhead();
    if (PV.playing) follow();
  });
})();
