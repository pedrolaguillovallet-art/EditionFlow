/* main.js: barra superior, atajos de teclado, importar/exportar y arranque. */
(function () {
  "use strict";
  var PV = (window.PV = window.PV || {});
  var $ = function (id) { return document.getElementById(id); };

  function renderTop() {
    var p = PV.project;
    if (!p) return;
    var active = document.activeElement;
    if (active !== $("title")) $("title").value = p.title;
    if (active !== $("bpm")) $("bpm").value = p.bpm > 0 ? p.bpm : "";
    $("snap").checked = !!p.snap;
    $("audio-name").textContent = p.audioName ? "♪ " + p.audioName : "";
    $("audio-name").title = p.audioName || "";
    var n = p.shots.length;
    $("stats").textContent = n + (n === 1 ? " plano" : " planos") + " · media " + (p.duration / n).toFixed(1) + " s";
    $("btn-undo").disabled = !PV.undoStack.length;
    $("btn-redo").disabled = !PV.redoStack.length;
    document.title = (p.title ? p.title + " · " : "") + "Planificador de videoclips";
  }
  PV.on("change", renderTop);
  PV.on("audio", renderTop);

  /* ---------- barra superior ---------- */
  var titleEl = $("title");
  titleEl.addEventListener("input", function () {
    var v = titleEl.value;
    PV.editField(function (p) { p.title = v; });
  });
  titleEl.addEventListener("change", function () { PV.endEdit(); });

  $("bpm").addEventListener("change", function () {
    var v = parseInt(this.value, 10);
    if (!isFinite(v) || v < 0) v = 0;
    v = Math.min(300, v);
    PV.commit(function (p) { p.bpm = v; });
  });

  var taps = [];
  $("btn-tap").addEventListener("click", function () {
    var now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 4) {
      PV.toast("Pulsa " + (4 - taps.length) + " vez" + (4 - taps.length === 1 ? "" : "es") + " más");
      return;
    }
    var avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    var bpm = PV.clamp(Math.round(60000 / avg), 1, 300);
    PV.commit(function (p) { p.bpm = bpm; });
    PV.toast("BPM " + bpm);
  });

  $("btn-beat1").addEventListener("click", function () {
    var off = Math.round(PV.time * 1000) / 1000;
    PV.commit(function (p) { p.beatOffset = off; });
    PV.toast("Primer tiempo en " + PV.fmtTime(off));
  });

  $("snap").addEventListener("change", function () {
    var v = this.checked;
    PV.commit(function (p) { p.snap = v; });
  });

  $("btn-audio").addEventListener("click", function () { $("audio-file").click(); });
  $("audio-file").addEventListener("change", function () {
    var f = this.files[0];
    this.value = "";
    if (f) PV.loadAudio(f, f.name);
  });

  // Soltar un audio en cualquier parte de la ventana; los demas archivos se ignoran.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (f && (f.type.indexOf("audio/") === 0 || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name))) PV.loadAudio(f, f.name);
  });

  $("btn-new").addEventListener("click", function () {
    $("new-dur").value = Math.round(PV.project.duration) || 180;
    $("new-dlg").hidden = false;
    $("new-dur").focus(); $("new-dur").select();
  });
  function closeNew() { $("new-dlg").hidden = true; }
  $("new-cancel").addEventListener("click", closeNew);
  $("new-dlg").addEventListener("keydown", function (e) { if (e.key === "Escape") closeNew(); e.stopPropagation(); });
  $("new-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var d = parseFloat(String($("new-dur").value).replace(",", "."));
    if (!(d > 0) || d > 36000) { PV.toast("Escribe una duración en segundos, por ejemplo 180"); return; }
    closeNew();
    PV.clearAudio();
    PV.replaceProject(PV.newProject(d));
  });

  $("btn-open").addEventListener("click", function () { $("json-file").click(); });
  $("json-file").addEventListener("change", function () {
    var f = this.files[0];
    this.value = "";
    if (!f) return;
    f.text().then(function (txt) {
      var obj = null;
      try { obj = JSON.parse(txt); } catch (e) { obj = null; }
      if (!obj || !Array.isArray(obj.sections) || !Array.isArray(obj.shots)) {
        PV.toast("Ese archivo no es un proyecto válido");
        return;
      }
      if (PV.hasAudio()) { obj.duration = PV.audioDuration; obj.audioName = PV.audioName; }
      PV.replaceProject(obj);
      PV.toast("Proyecto abierto");
    });
  });

  $("btn-save").addEventListener("click", function () {
    var name = (PV.project.title || "videoclip").replace(/[\\/:*?"<>|]+/g, "_").trim() || "videoclip";
    var blob = new Blob([JSON.stringify(PV.project, null, 2)], { type: "application/json" });
    PV.download(name + ".videoclip.json", blob);
  });

  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
  $("btn-csv").addEventListener("click", function () {
    var p = PV.project, rows = [["Nº", "Inicio", "Fin", "Duración", "Sección", "Categoría", "Tipo", "Movimiento",
      "Localización", "Descripción", "Notas", "Rodado"]];
    p.shots.forEach(function (s, i) {
      var end = PV.itemEnd(p.shots, i), si = PV.indexAt(p.sections, s.start);
      rows.push([i + 1, PV.fmtTime(s.start), PV.fmtTime(end), (end - s.start).toFixed(1),
        PV.sectionLabel(p.sections[si]), PV.categoryLabel(s.category), s.shotType, s.movement, s.location,
        s.description, s.notes, s.done ? "Sí" : "No"]);
    });
    var text = "﻿" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
    PV.download((p.title || "videoclip").replace(/[\\/:*?"<>|]+/g, "_") + ".csv",
      new Blob([text], { type: "text/csv;charset=utf-8" }));
  });

  $("btn-print").addEventListener("click", function () { window.print(); });
  $("btn-undo").addEventListener("click", function () { PV.undo(); });
  $("btn-redo").addEventListener("click", function () { PV.redo(); });

  /* ---------- transporte y cortes ---------- */
  $("btn-play").addEventListener("click", function () { PV.toggle(); });

  function cutShot() {
    var t = PV.time, p = PV.project;
    if (p.snap && p.bpm > 0 && PV.playing) {
      var b = PV.nearestBeat(t);
      if (Math.abs(b - t) <= 0.12) t = b;
    }
    var it = PV.cut("shots", t);
    if (it) PV.select("shot", it.id);
  }
  function cutSection() {
    var t = PV.time, p = PV.project;
    if (p.snap && p.bpm > 0 && PV.playing) {
      var b = PV.nearestBeat(t);
      if (Math.abs(b - t) <= 0.12) t = b;
    }
    var it = PV.cut("sections", t);
    if (it) PV.select("section", it.id);
  }
  $("btn-cut-shot").addEventListener("click", cutShot);
  $("btn-cut-sec").addEventListener("click", cutSection);

  function moveShot(dir) {
    var shots = PV.project.shots, cur = -1;
    if (PV.selection.kind === "shot") cur = PV.indexById(shots, PV.selection.id);
    if (cur < 0) cur = PV.indexAt(shots, PV.time);
    var n = PV.clamp(cur + dir, 0, shots.length - 1);
    PV.select("shot", shots[n].id);
    PV.seek(shots[n].start);
    PV.ensureVisible(shots[n].start);
  }

  /* ---------- atajos ---------- */
  document.addEventListener("keydown", function (e) {
    var t = e.target, tag = t && t.tagName;
    var editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(t && t.isContentEditable);
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "z" || k === "Z")) {
      if (editable) return;
      e.preventDefault();
      if (e.shiftKey) PV.redo(); else PV.undo();
      return;
    }
    if (mod && (k === "y" || k === "Y")) {
      if (editable) return;
      e.preventDefault();
      PV.redo();
      return;
    }
    if (editable || mod || e.altKey || !PV.project) return;
    switch (k) {
      case " ":
        e.preventDefault();
        if (!e.repeat) PV.toggle();
        break;
      case "c":
      case "C":
        if (!e.repeat) cutShot();
        break;
      case "s":
      case "S":
        if (!e.repeat) cutSection();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        PV.seek(PV.time + (k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 1));
        PV.ensureVisible(PV.time);
        break;
      case "ArrowUp":
      case "ArrowDown":
        e.preventDefault();
        moveShot(k === "ArrowDown" ? 1 : -1);
        break;
      case "Delete":
      case "Backspace":
        if (PV.selection.kind) {
          e.preventDefault();
          PV.removeItem(PV.selection.kind === "shot" ? "shots" : "sections", PV.selection.id);
        }
        break;
      default:
        break;
    }
  });

  // Tras pulsar un boton, quitarle el foco para que Espacio no lo vuelva a activar.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button");
    if (b) b.blur();
  });

  /* ---------- arranque ---------- */
  PV.boot = function () {
    Promise.all([PV.kvGet("project"), PV.kvGet("audio")]).then(function (r) {
      var p = r[0], file = r[1];
      if (!p || typeof p !== "object" || !Array.isArray(p.sections) || !Array.isArray(p.shots)) p = PV.demoProject();
      PV.project = PV.normalize(p);
      PV.finishChange({ boot: true });
      if (file && typeof file.size === "number") return PV.loadAudio(file, PV.project.audioName, { restore: true });
    }).catch(function () {
      if (!PV.project) {
        PV.project = PV.normalize(PV.demoProject());
        PV.finishChange({ boot: true });
      }
    });
  };
  PV.boot();
})();
