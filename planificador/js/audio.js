/* audio.js: carga de audio, picos de forma de onda y reloj de transporte. */
(function () {
  "use strict";
  var PV = (window.PV = window.PV || {});
  var player = document.getElementById("player");
  var blob = null, objUrl = null, rafId = 0, silentBase = 0, silentStart = 0;

  PV.time = 0;
  PV.playing = false;
  PV.peaks = null;     // Float32Array, 100 valores por segundo
  PV.peakMax = 1;
  PV.audioDuration = 0;
  PV.audioName = "";

  PV.hasAudio = function () { return !!blob; };

  function computePeaks(ab) {
    var sr = ab.sampleRate, data = ab.getChannelData(0);
    var n = Math.ceil(ab.duration * 100), out = new Float32Array(n);
    for (var k = 0; k < n; k++) {
      var a = Math.floor(k * sr / 100), b = Math.min(data.length, Math.floor((k + 1) * sr / 100)), m = 0;
      for (var i = a; i < b; i++) {
        var v = data[i];
        if (v < 0) v = -v;
        if (v > m) m = v;
      }
      out[k] = m;
    }
    return out;
  }

  // opts.restore: al reabrir la pagina no se modifica el undo ni se vuelve a guardar el blob.
  PV.loadAudio = function (file, name, opts) {
    var AC = window.AudioContext || window.webkitAudioContext;
    PV.pause();
    if (!AC) { PV.toast("Este navegador no puede leer audio"); return Promise.resolve(false); }
    var ctx = null;
    return file.arrayBuffer().then(function (buf) {
      ctx = new AC();
      return ctx.decodeAudioData(buf);
    }).then(function (ab) {
      var peaks = computePeaks(ab), dur = ab.duration, max = 0;
      for (var i = 0; i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      if (ctx && ctx.close) ctx.close();
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = URL.createObjectURL(file);
      player.src = objUrl;
      blob = file;
      PV.peaks = peaks;
      PV.peakMax = max || 1;
      PV.audioDuration = dur;
      PV.audioName = name || file.name || "audio";
      if (opts && opts.restore) {
        PV.project.duration = dur;
        PV.project.audioName = PV.audioName;
        PV.finishChange({});
      } else {
        PV.commit(function (p) { p.duration = dur; p.audioName = PV.audioName; });
        PV.kvSet("audio", file);
      }
      PV.seek(PV.time);
      PV.emit("audio");
      return true;
    }).catch(function () {
      if (ctx && ctx.close) ctx.close();
      PV.toast("No se pudo leer el audio");
      return false;
    });
  };

  PV.clearAudio = function () {
    PV.pause();
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = null;
    blob = null;
    player.removeAttribute("src");
    PV.peaks = null;
    PV.audioDuration = 0;
    PV.audioName = "";
    PV.kvDel("audio");
    PV.emit("audio");
  };

  /* ---------- transporte ---------- */
  PV.seek = function (t) {
    var dur = PV.project.duration;
    t = PV.clamp(Number(t) || 0, 0, dur);
    PV.time = t;
    if (blob) {
      try { player.currentTime = t; } catch (e) { /* aun sin metadatos */ }
    } else {
      silentBase = t;
      silentStart = performance.now();
    }
    PV.emit("time");
  };

  PV.play = function () {
    if (PV.playing || !PV.project) return;
    if (PV.time >= PV.project.duration - 0.05) PV.seek(0);
    PV.playing = true;
    if (blob) {
      try { player.currentTime = PV.time; } catch (e) { /* ignorar */ }
      var p = player.play();
      if (p && p.catch) p.catch(function () { PV.pause(); PV.toast("No se pudo reproducir el audio"); });
    } else {
      silentBase = PV.time;
      silentStart = performance.now();
    }
    rafId = requestAnimationFrame(tick);
    PV.emit("time");
  };

  PV.pause = function () {
    if (!PV.playing) return;
    PV.playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (blob) {
      try { player.pause(); } catch (e) { /* ignorar */ }
      PV.time = player.currentTime || PV.time;
    } else {
      silentBase = PV.time;
    }
    PV.emit("time");
  };

  PV.toggle = function () { if (PV.playing) PV.pause(); else PV.play(); };

  function tick() {
    rafId = 0;
    if (!PV.playing) return;
    var dur = PV.project.duration;
    var t = blob ? player.currentTime : silentBase + (performance.now() - silentStart) / 1000;
    if (t >= dur) {
      PV.time = dur;
      PV.pause();
      return;
    }
    PV.time = t;
    PV.emit("time");
    rafId = requestAnimationFrame(tick);
  }

  player.addEventListener("ended", function () { PV.pause(); });
  PV.on("change", function () {
    if (PV.project && PV.time > PV.project.duration) PV.seek(PV.project.duration);
  });
})();
