/* store.js: modelo de datos, deshacer/rehacer, eventos, persistencia y helpers. */
(function () {
  "use strict";
  var PV = (window.PV = window.PV || {});

  /* ---------- enumeraciones ---------- */
  PV.SECTION_TYPES = [
    ["intro", "Intro", "#64748b"], ["estrofa", "Estrofa", "#3b82f6"], ["pre", "Pre-estribillo", "#8b5cf6"],
    ["estribillo", "Estribillo", "#ef4444"], ["puente", "Puente", "#f59e0b"],
    ["instrumental", "Instrumental", "#10b981"], ["outro", "Outro", "#64748b"], ["otro", "Otro", "#475569"]
  ];
  PV.CATEGORIES = [
    ["playback", "Playback", "#f43f5e"], ["narrativa", "Narrativa", "#38bdf8"],
    ["broll", "B-roll", "#a3e635"], ["baile", "Baile", "#c084fc"], ["otro", "Otro", "#94a3b8"]
  ];
  PV.SHOT_TYPES = ["", "Gran plano general", "Plano general", "Plano americano", "Plano medio", "Primer plano",
    "Primerísimo primer plano", "Plano detalle", "Cenital", "Dron"];
  PV.SHOT_ABBR = {
    "Gran plano general": "GPG", "Plano general": "PG", "Plano americano": "PA", "Plano medio": "PM",
    "Primer plano": "PP", "Primerísimo primer plano": "PPP", "Plano detalle": "PD", "Cenital": "CEN", "Dron": "DRON"
  };
  PV.MOVEMENTS = ["", "Fijo", "Paneo", "Travelling", "Steadicam", "Cámara en mano", "Zoom", "Grúa", "Dron"];

  PV.lookup = function (list, key) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i];
    return null;
  };
  PV.sectionLabel = function (s) {
    if (!s) return "";
    if (s.name) return s.name;
    var t = PV.lookup(PV.SECTION_TYPES, s.type);
    return t ? t[1] : "Sección";
  };
  PV.sectionColor = function (s) {
    var t = PV.lookup(PV.SECTION_TYPES, s && s.type);
    return t ? t[2] : "#475569";
  };
  PV.categoryLabel = function (key) { var c = PV.lookup(PV.CATEGORIES, key) || PV.CATEGORIES[4]; return c[1]; };
  PV.categoryColor = function (key) { var c = PV.lookup(PV.CATEGORIES, key) || PV.CATEGORIES[4]; return c[2]; };
  PV.validImage = function (s) { return typeof s === "string" && s.indexOf("data:image/") === 0 ? s : ""; };

  /* ---------- utilidades ---------- */
  PV.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  PV.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  PV.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  PV.h = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // m:ss.d, e.g. 1:07.3
  PV.fmtTime = function (t) {
    var tenths = Math.round(Math.max(0, Number(t) || 0) * 10);
    var m = Math.floor(tenths / 600), rest = tenths - m * 600;
    var s = Math.floor(rest / 10), d = rest % 10;
    return m + ":" + (s < 10 ? "0" : "") + s + "." + d;
  };
  PV.itemEnd = function (list, i) {
    return i + 1 < list.length ? list[i + 1].start : PV.project.duration;
  };
  PV.indexAt = function (list, t) {
    for (var i = list.length - 1; i > 0; i--) if (list[i].start <= t) return i;
    return 0;
  };
  PV.indexById = function (list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  };
  PV.nearestBeat = function (t) {
    var p = PV.project;
    if (!(p.bpm > 0)) return t;
    var step = 60 / p.bpm;
    return p.beatOffset + Math.round((t - p.beatOffset) / step) * step;
  };

  PV.newSection = function (start) { return { id: PV.uid(), start: start || 0, type: "estrofa", name: "" }; };
  PV.newShot = function (start) {
    return { id: PV.uid(), start: start || 0, description: "", shotType: "", movement: "", category: "playback",
      location: "", notes: "", image: "", done: false };
  };

  PV.demoProject = function () {
    var secs = [[0, "intro"], [15, "estrofa"], [45, "estribillo"], [75, "estrofa"], [105, "estribillo"],
      [135, "puente"], [155, "outro"]];
    var shots = [
      [0, "Plano cenital del estudio vacío", "Cenital", "Fijo", "broll", "Estudio", true],
      [15, "La cantante camina por la calle de noche", "Plano medio", "Steadicam", "narrativa", "Calle del centro", false],
      [45, "Playback frontal bajo luces de neón", "Plano americano", "Cámara en mano", "playback", "Estudio", false],
      [75, "Detalle de unas manos sobre la guitarra", "Plano detalle", "Fijo", "broll", "Estudio", false],
      [105, "El grupo baila en la azotea", "Gran plano general", "Dron", "baile", "Azotea", false],
      [135, "Primer plano, mirada a cámara", "Primerísimo primer plano", "Zoom", "playback", "Estudio", false],
      [155, "Amanecer sobre la ciudad", "Dron", "Grúa", "narrativa", "Azotea", false]
    ];
    return {
      version: 1, title: "Proyecto de ejemplo", duration: 180, audioName: "", bpm: 0, beatOffset: 0, snap: true,
      sections: secs.map(function (s) { return { id: PV.uid(), start: s[0], type: s[1], name: "" }; }),
      shots: shots.map(function (s) {
        return { id: PV.uid(), start: s[0], description: s[1], shotType: s[2], movement: s[3], category: s[4],
          location: s[5], notes: "", image: "", done: s[6] };
      })
    };
  };
  PV.newProject = function (d) {
    var sec = PV.newSection(0); sec.type = "intro";
    return { version: 1, title: "Mi videoclip", duration: d, audioName: "", bpm: 0, beatOffset: 0, snap: true,
      sections: [sec], shots: [PV.newShot(0)] };
  };

  /* ---------- normalizacion ---------- */
  function str(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function idOf(x) { return typeof x.id === "string" && x.id ? x.id : PV.uid(); }
  function pick(list, key, fb) { return PV.lookup(list, key) ? key : fb; }
  function mkSection(x) {
    return { id: idOf(x), start: num(x.start), type: pick(PV.SECTION_TYPES, x.type, "estrofa"), name: str(x.name) };
  }
  function mkShot(x) {
    return {
      id: idOf(x), start: num(x.start), description: str(x.description), shotType: str(x.shotType),
      movement: str(x.movement), category: pick(PV.CATEGORIES, x.category, "playback"), location: str(x.location),
      notes: str(x.notes), image: str(x.image), done: !!x.done
    };
  }
  function fixTrack(raw, make, dur) {
    var items = [];
    (Array.isArray(raw) ? raw : []).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var it = make(x);
      if (isFinite(it.start)) items.push(it);
    });
    items.sort(function (a, b) { return a.start - b.start; });
    var out = [];
    items.forEach(function (it) {
      if (it.start >= dur) return;
      if (it.start < 0) it.start = 0;
      if (out.length && it.start - out[out.length - 1].start < 0.01) return;
      out.push(it);
    });
    if (!out.length) out.push(make({ start: 0 }));
    out[0].start = 0;
    return out;
  }
  PV.normalize = function (p) {
    p = p || {};
    p.version = 1;
    p.title = str(p.title);
    var d = num(p.duration);
    p.duration = d > 0 ? d : 180;
    p.audioName = str(p.audioName);
    var b = Math.round(num(p.bpm));
    p.bpm = b > 0 ? Math.min(300, b) : 0;
    var bo = num(p.beatOffset);
    p.beatOffset = isFinite(bo) ? bo : 0;
    p.snap = p.snap !== false;
    p.sections = fixTrack(p.sections, mkSection, p.duration);
    p.shots = fixTrack(p.shots, mkShot, p.duration);
    return p;
  };

  /* ---------- eventos ---------- */
  var handlers = {};
  PV.on = function (name, cb) { (handlers[name] = handlers[name] || []).push(cb); };
  PV.emit = function (name, data) {
    var list = handlers[name];
    if (list) list.slice().forEach(function (cb) { cb(data); });
  };

  /* ---------- estado ---------- */
  PV.project = null;
  PV.selection = { kind: null, id: null };
  PV.undoStack = [];
  PV.redoStack = [];
  PV._editing = false;

  PV.select = function (kind, id) {
    PV.selection = { kind: kind || null, id: id || null };
    PV.emit("select", PV.selection);
  };
  PV.validateSelection = function () {
    var s = PV.selection;
    if (!s.kind) return;
    var list = s.kind === "shot" ? PV.project.shots : PV.project.sections;
    if (PV.indexById(list, s.id) < 0) PV.select(null, null);
  };
  PV.toast = function (msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(PV._toastTimer);
    PV._toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1800);
  };

  /* ---------- cambios, undo / redo ---------- */
  PV.pushUndo = function () {
    PV.undoStack.push(JSON.stringify(PV.project));
    if (PV.undoStack.length > 100) PV.undoStack.shift();
    PV.redoStack = [];
  };
  function finishChange(data) {
    PV.normalize(PV.project);
    PV.validateSelection();
    PV.emit("change", data || {});
  }
  PV.finishChange = finishChange;
  PV.commit = function (fn) {
    PV.pushUndo();
    PV._editing = false;
    fn(PV.project);
    finishChange({});
  };
  // Actualiza el modelo sin registrar undo ni re-renderizar el inspector (arrastres).
  PV.mutateSilently = function (fn) {
    fn(PV.project);
    finishChange({ light: true });
  };
  // Edicion de texto: un solo paso de undo por sesion de escritura.
  PV.editField = function (fn) {
    if (!PV._editing) { PV.pushUndo(); PV._editing = true; }
    fn(PV.project);
    finishChange({ light: true });
  };
  PV.endEdit = function () {
    PV._editing = false;
    PV.emit("change", { light: true });
  };
  PV.undo = function () {
    if (!PV.undoStack.length) return;
    PV.redoStack.push(JSON.stringify(PV.project));
    PV.project = PV.normalize(JSON.parse(PV.undoStack.pop()));
    PV._editing = false;
    finishChange({ history: true });
  };
  PV.redo = function () {
    if (!PV.redoStack.length) return;
    PV.undoStack.push(JSON.stringify(PV.project));
    PV.project = PV.normalize(JSON.parse(PV.redoStack.pop()));
    PV._editing = false;
    finishChange({ history: true });
  };
  PV.replaceProject = function (p) {
    PV.pushUndo();
    PV._editing = false;
    PV.project = PV.normalize(p);
    finishChange({});
  };

  /* ---------- cortes y bloques ---------- */
  // track: "shots" | "sections". Devuelve el item creado o null.
  PV.cut = function (track, t) {
    var p = PV.project, list = p[track];
    if (!(t > 0.2) || !(t < p.duration - 0.2)) { PV.toast("No se puede cortar aquí"); return null; }
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].start - t) < 0.2) { PV.toast("Demasiado cerca de otro corte"); return null; }
    }
    var item = track === "shots" ? PV.newShot(t) : PV.newSection(t);
    PV.commit(function (pp) { pp[track].push(item); });
    return { id: item.id };
  };
  // Elimina un item: el anterior absorbe su tiempo. Si es el unico, limpia sus campos.
  PV.removeItem = function (track, id) {
    var list = PV.project[track], i = PV.indexById(list, id);
    if (i < 0) return;
    var kind = track === "shots" ? "shot" : "section";
    if (list.length === 1) {
      PV.commit(function (p) {
        var it = p[track][0];
        if (track === "shots") {
          it.description = ""; it.shotType = ""; it.movement = ""; it.category = "playback";
          it.location = ""; it.notes = ""; it.image = ""; it.done = false;
        } else {
          it.type = "estrofa"; it.name = "";
        }
      });
      return;
    }
    var nextSel = i > 0 ? list[i - 1].id : list[1].id;
    PV.commit(function (p) {
      p[track].splice(i, 1);
      p[track][0].start = 0;
    });
    PV.select(kind, nextSel);
  };

  /* ---------- persistencia (IndexedDB, con fallo silencioso) ---------- */
  var dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        try {
          var req = indexedDB.open("planificador", 1);
          req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
          req.onblocked = function () { reject(new Error("blocked")); };
        } catch (e) { reject(e); }
      });
    }
    return dbPromise;
  }
  function kvOp(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", mode);
        var req = fn(tx.objectStore("kv"));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  PV.kvGet = function (k) { return kvOp("readonly", function (st) { return st.get(k); }).catch(function () { return undefined; }); };
  PV.kvSet = function (k, v) { return kvOp("readwrite", function (st) { return st.put(v, k); }).catch(function () {}); };
  PV.kvDel = function (k) { return kvOp("readwrite", function (st) { return st.delete(k); }).catch(function () {}); };

  var saveTimer = null;
  PV.saveNow = function () {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (PV.project) PV.kvSet("project", PV.project);
  };
  PV.on("change", function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(PV.saveNow, 500);
  });
  window.addEventListener("pagehide", PV.saveNow);

  /* ---------- descarga ---------- */
  PV.download = function (name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };
})();
