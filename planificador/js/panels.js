/* panels.js: monitor, inspector, storyboard y lista de rodaje. */
(function () {
  "use strict";
  var PV = (window.PV = window.PV || {});
  var $ = function (id) { return document.getElementById(id); };
  var h = PV.h;
  var monBox = $("monitor-box"), readoutEl = $("time-readout"), btnPlay = $("btn-play"),
    insp = $("inspector"), sbWrap = $("tab-storyboard"), rodWrap = $("tab-rodaje"), printTitle = $("print-title");
  var lastMon = "", lastCur = -1, tab = "storyboard";

  var HELP =
    '<div class="help"><h3>Cómo planificar</h3><ol>' +
    '<li>Carga la canción.</li>' +
    '<li>Dale a reproducir y pulsa <kbd>S</kbd> para marcar cada parte de la canción.</li>' +
    '<li>Vuelve a escuchar y pulsa <kbd>C</kbd> en cada cambio de plano.</li>' +
    '<li>Selecciona cada plano y descríbelo.</li></ol>' +
    '<h3>Atajos</h3><ul>' +
    '<li><kbd>Espacio</kbd> reproducir / pausa</li>' +
    '<li><kbd>C</kbd> cortar plano · <kbd>S</kbd> cortar sección</li>' +
    '<li><kbd>←</kbd> <kbd>→</kbd> ±1 s (con <kbd>Mayús</kbd>, ±0,1 s)</li>' +
    '<li><kbd>↑</kbd> <kbd>↓</kbd> plano anterior / siguiente</li>' +
    '<li><kbd>Supr</kbd> eliminar (lo absorbe el anterior)</li>' +
    '<li><kbd>Ctrl+Z</kbd> deshacer · <kbd>Ctrl+Mayús+Z</kbd> rehacer</li></ul></div>';

  function selId(kind) { return PV.selection.kind === kind ? PV.selection.id : null; }

  /* ---------- monitor ---------- */
  function monitorKey() {
    var p = PV.project;
    return PV.indexAt(p.shots, PV.time) + "|" + PV.indexAt(p.sections, PV.time);
  }
  function renderMonitor() {
    var p = PV.project;
    if (!p || !p.shots.length) return;
    var si = PV.indexAt(p.shots, PV.time), sec = PV.indexAt(p.sections, PV.time);
    var sh = p.shots[si], s = p.sections[sec];
    lastMon = si + "|" + sec;
    monBox.textContent = "";
    var media = h("div", "mon-media"), img = PV.validImage(sh.image);
    if (img) {
      var im = h("img");
      im.src = img;
      im.alt = "";
      media.appendChild(im);
    } else {
      media.style.background = "linear-gradient(135deg," + PV.categoryColor(sh.category) + "99,#0b0d11 85%)";
      media.appendChild(h("div", "mon-abbr", PV.SHOT_ABBR[sh.shotType] || PV.categoryLabel(sh.category)));
    }
    monBox.appendChild(media);
    monBox.appendChild(h("div", "mon-chip mon-num", "Plano " + (si + 1)));
    var secChip = h("div", "mon-chip mon-sec", PV.sectionLabel(s));
    secChip.style.background = PV.sectionColor(s);
    monBox.appendChild(secChip);
    var bar = h("div", "mon-bar");
    bar.appendChild(h("div", "mon-desc", sh.description || "(sin descripción)"));
    bar.appendChild(h("div", "mon-meta", [sh.shotType, sh.movement, sh.location].filter(Boolean).join(" · ")));
    monBox.appendChild(bar);
  }
  function readout() {
    if (!PV.project) return;
    readoutEl.textContent = PV.fmtTime(PV.time) + " / " + PV.fmtTime(PV.project.duration);
    btnPlay.textContent = PV.playing ? "⏸" : "▶";
  }

  /* ---------- inspector ---------- */
  function listOpts(values, cur) {
    var vals = values.slice();
    if (cur && vals.indexOf(cur) < 0) vals.push(cur);
    return vals.map(function (v) {
      return '<option value="' + PV.esc(v) + '"' + (v === cur ? " selected" : "") + ">" +
        (v ? PV.esc(v) : "— sin definir —") + "</option>";
    }).join("");
  }
  function typeOpts(cur) {
    return PV.SECTION_TYPES.map(function (t) {
      return '<option value="' + t[0] + '"' + (t[0] === cur ? " selected" : "") + ">" + t[1] + "</option>";
    }).join("");
  }
  function setField(p, track, id, f, v) {
    var k = PV.indexById(p[track], id);
    if (k >= 0) p[track][k][f] = v;
  }
  function renderInspector() {
    var p = PV.project, s = PV.selection;
    if (!p) return;
    if (s.kind === "section") {
      var si = PV.indexById(p.sections, s.id);
      if (si >= 0) return sectionForm(si);
    } else if (s.kind === "shot") {
      var i = PV.indexById(p.shots, s.id);
      if (i >= 0) return shotForm(i);
    }
    insp.innerHTML = HELP;
  }
  function sectionForm(i) {
    var p = PV.project, sec = p.sections[i], end = PV.itemEnd(p.sections, i);
    insp.innerHTML =
      '<div class="ihead">Sección · ' + PV.fmtTime(sec.start) + " – " + PV.fmtTime(end) + "</div>" +
      "<label>Tipo</label><select data-f=\"type\">" + typeOpts(sec.type) + "</select>" +
      '<label>Nombre</label><input type="text" data-f="name" placeholder="p. ej. Estrofa 2" value="' + PV.esc(sec.name) + '">' +
      '<div class="ibtns"><button class="danger" data-act="del">Eliminar sección</button></div>';
    bindForm("sections", sec.id);
  }
  function shotForm(i) {
    var p = PV.project, sh = p.shots[i], end = PV.itemEnd(p.shots, i), img = PV.validImage(sh.image);
    var locs = [];
    p.shots.forEach(function (x) { if (x.location && locs.indexOf(x.location) < 0) locs.push(x.location); });
    locs.sort();
    var pills = PV.CATEGORIES.map(function (c) {
      return '<button type="button" class="pill' + (c[0] === sh.category ? " on" : "") + '" data-cat="' + c[0] +
        '" style="--c:' + c[2] + '">' + c[1] + "</button>";
    }).join("");
    var drop = img
      ? '<img src="' + PV.esc(img) + '" alt=""><button class="small" data-act="noimg">Quitar</button>'
      : "<span>Arrastra una imagen de referencia o haz clic</span>";
    insp.innerHTML =
      '<div class="ihead">Plano ' + (i + 1) + " · " + PV.fmtTime(sh.start) + " – " + PV.fmtTime(end) +
      " (" + (end - sh.start).toFixed(1) + " s)</div>" +
      '<div class="dropzone" id="dropzone">' + drop + '<input type="file" id="img-file" accept="image/*" hidden></div>' +
      '<label>Descripción</label><textarea rows="3" data-f="description" placeholder="¿Qué se ve en este plano?">' +
      PV.esc(sh.description) + "</textarea>" +
      "<label>Categoría</label><div class=\"pills\">" + pills + "</div>" +
      '<div class="row2"><div><label>Tipo de plano</label><select data-f="shotType">' + listOpts(PV.SHOT_TYPES, sh.shotType) +
      '</select></div><div><label>Movimiento</label><select data-f="movement">' + listOpts(PV.MOVEMENTS, sh.movement) +
      "</select></div></div>" +
      '<label>Localización</label><input type="text" data-f="location" list="dl-loc" value="' + PV.esc(sh.location) + '">' +
      '<datalist id="dl-loc">' + locs.map(function (l) { return '<option value="' + PV.esc(l) + '">'; }).join("") + "</datalist>" +
      '<label>Notas</label><textarea rows="2" data-f="notes" placeholder="Vestuario, luz, atrezzo…">' + PV.esc(sh.notes) + "</textarea>" +
      '<label class="check"><input type="checkbox" data-f="done"' + (sh.done ? " checked" : "") + "> Rodado</label>" +
      '<div class="ibtns"><button class="danger" data-act="del">Eliminar plano</button></div>';
    bindForm("shots", sh.id);
    bindDrop(sh.id);
  }
  function bindForm(track, id) {
    insp.querySelectorAll("[data-f]").forEach(function (node) {
      var f = node.dataset.f;
      if (node.tagName === "SELECT" || node.type === "checkbox") {
        node.addEventListener("change", function () {
          var v = node.type === "checkbox" ? node.checked : node.value;
          PV.commit(function (p) { setField(p, track, id, f, v); });
        });
      } else {
        node.addEventListener("input", function () {
          var v = node.value;
          PV.editField(function (p) { setField(p, track, id, f, v); });
        });
        node.addEventListener("change", function () { PV.endEdit(); });
      }
    });
    insp.querySelectorAll(".pill").forEach(function (b) {
      b.addEventListener("click", function () {
        PV.commit(function (p) { setField(p, track, id, "category", b.dataset.cat); });
      });
    });
    var del = insp.querySelector('[data-act="del"]');
    if (del) del.addEventListener("click", function () { PV.removeItem(track, id); });
    var noimg = insp.querySelector('[data-act="noimg"]');
    if (noimg) {
      noimg.addEventListener("click", function (e) {
        e.stopPropagation();
        PV.commit(function (p) { setField(p, track, id, "image", ""); });
      });
    }
  }
  function bindDrop(id) {
    var dz = $("dropzone"), fi = $("img-file");
    dz.addEventListener("click", function (e) { if (!e.target.closest("button")) fi.click(); });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("over");
      if (e.dataTransfer.files[0]) processImage(e.dataTransfer.files[0], id);
    });
    fi.addEventListener("change", function () { if (fi.files[0]) processImage(fi.files[0], id); });
  }
  // Reduce la imagen a 640 px de ancho y la guarda como JPEG (data URL) en el plano.
  function processImage(file, id) {
    if (!file || file.type.indexOf("image/") !== 0) { PV.toast("Eso no es una imagen"); return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var nw = img.naturalWidth || 1, w = Math.min(640, nw), hgt = Math.max(1, Math.round(img.naturalHeight * w / nw));
      var c = document.createElement("canvas");
      c.width = w;
      c.height = hgt;
      c.getContext("2d").drawImage(img, 0, 0, w, hgt);
      var data = c.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      PV.commit(function (p) { setField(p, "shots", id, "image", data); });
    };
    img.onerror = function () { URL.revokeObjectURL(url); PV.toast("No se pudo leer esa imagen"); };
    img.src = url;
  }

  /* ---------- storyboard ---------- */
  function storyCard(sh, i) {
    var p = PV.project, c = h("div", "card");
    c.dataset.id = sh.id;
    var th = h("div", "thumb"), img = PV.validImage(sh.image);
    if (img) {
      th.style.backgroundImage = 'url("' + img + '")';
    } else {
      th.style.background = PV.categoryColor(sh.category) + "77";
      th.appendChild(h("span", "abbr", PV.SHOT_ABBR[sh.shotType] || PV.categoryLabel(sh.category)));
    }
    var body = h("div", "card-body"), title = h("div", "card-title");
    title.appendChild(h("b", "", (i + 1) + " · " + PV.fmtTime(sh.start) + " · " +
      (PV.itemEnd(p.shots, i) - sh.start).toFixed(1) + " s"));
    if (sh.done) title.appendChild(document.createTextNode("  ✓"));
    body.appendChild(title);
    body.appendChild(h("div", "card-desc", sh.description || "(sin descripción)"));
    var chips = h("div", "chips");
    [sh.shotType, sh.movement, sh.location].forEach(function (v) { if (v) chips.appendChild(h("span", "chip", v)); });
    body.appendChild(chips);
    c.appendChild(th);
    c.appendChild(body);
    return c;
  }
  function renderStoryboard() {
    var p = PV.project, groups = p.sections.map(function () { return []; });
    sbWrap.textContent = "";
    lastCur = -1;
    p.shots.forEach(function (sh, i) { groups[PV.indexAt(p.sections, sh.start)].push(i); });
    p.sections.forEach(function (s, si) {
      var end = PV.itemEnd(p.sections, si), color = PV.sectionColor(s), n = groups[si].length;
      var box = h("section", "sb-sec"), head = h("div", "sb-head");
      head.style.borderLeftColor = color;
      var dot = h("span", "dot");
      dot.style.background = color;
      head.appendChild(dot);
      head.appendChild(h("span", "", PV.sectionLabel(s)));
      head.appendChild(h("span", "meta", PV.fmtTime(s.start) + " – " + PV.fmtTime(end) + " · " + n + (n === 1 ? " plano" : " planos")));
      box.appendChild(head);
      var grid = h("div", "sb-grid");
      groups[si].forEach(function (i) { grid.appendChild(storyCard(p.shots[i], i)); });
      box.appendChild(grid);
      sbWrap.appendChild(box);
    });
    markSelection();
    markCurrent(true);
  }
  function markSelection() {
    var id = selId("shot");
    [sbWrap, rodWrap].forEach(function (w) {
      w.querySelectorAll("[data-id]").forEach(function (n) { n.classList.toggle("sel", id !== null && n.dataset.id === id); });
    });
  }
  function markCurrent(force) {
    var p = PV.project;
    if (!p) return;
    var idx = PV.indexAt(p.shots, PV.time);
    if (!force && idx === lastCur) return;
    lastCur = idx;
    sbWrap.querySelectorAll(".card.cur").forEach(function (n) { n.classList.remove("cur"); });
    var n = sbWrap.querySelector('.card[data-id="' + p.shots[idx].id + '"]');
    if (n) n.classList.add("cur");
  }

  /* ---------- lista de rodaje ---------- */
  function rodRow(sh, i) {
    var p = PV.project, tr = h("tr"), end = PV.itemEnd(p.shots, i);
    tr.dataset.id = sh.id;
    var cb = h("input");
    cb.type = "checkbox";
    cb.checked = sh.done;
    cb.addEventListener("change", function () {
      PV.commit(function (pp) { setField(pp, "shots", sh.id, "done", cb.checked); });
    });
    var tdDone = h("td");
    tdDone.appendChild(cb);
    tr.appendChild(tdDone);
    var cat = PV.lookup(PV.CATEGORIES, sh.category) || PV.CATEGORIES[4];
    var tdCat = h("td"), dot = h("span", "catdot");
    dot.style.background = cat[2];
    tdCat.appendChild(dot);
    tdCat.appendChild(document.createTextNode(cat[1]));
    var si = PV.indexAt(p.sections, sh.start);
    tr.appendChild(h("td", "", String(i + 1)));
    tr.appendChild(h("td", "", PV.fmtTime(sh.start)));
    tr.appendChild(h("td", "", (end - sh.start).toFixed(1) + " s"));
    tr.appendChild(h("td", "", PV.sectionLabel(p.sections[si])));
    tr.appendChild(tdCat);
    tr.appendChild(h("td", "", sh.shotType || "—"));
    tr.appendChild(h("td", "", sh.movement || "—"));
    tr.appendChild(h("td", "wrap", sh.description));
    tr.appendChild(h("td", "wrap", sh.notes));
    return tr;
  }
  function renderRodaje() {
    var p = PV.project, order = [], byLoc = {};
    p.shots.forEach(function (sh, i) {
      var k = sh.location || "";
      if (!byLoc[k]) { byLoc[k] = []; order.push(k); }
      byLoc[k].push(i);
    });
    order.sort(function (a, b) { if (a === "") return 1; if (b === "") return -1; return 0; });
    rodWrap.textContent = "";
    var table = h("table", "rodaje");
    table.innerHTML = "<thead><tr><th>✓</th><th>Nº</th><th>Tiempo</th><th>Dur.</th><th>Sección</th><th>Categoría</th>" +
      "<th>Tipo</th><th>Movimiento</th><th>Descripción</th><th>Notas</th></tr></thead>";
    var tb = document.createElement("tbody");
    order.forEach(function (k) {
      var n = byLoc[k].length, tr = h("tr", "grp"), td = h("td", "", (k || "Sin localización") + " · " + n + (n === 1 ? " plano" : " planos"));
      td.colSpan = 10;
      tr.appendChild(td);
      tb.appendChild(tr);
      byLoc[k].forEach(function (i) { tb.appendChild(rodRow(p.shots[i], i)); });
    });
    table.appendChild(tb);
    rodWrap.appendChild(table);
    markSelection();
  }

  function renderBottom() {
    if (!PV.project) return;
    printTitle.textContent = PV.project.title || "Planificador de videoclips";
    if (tab === "storyboard") renderStoryboard(); else renderRodaje();
  }

  /* ---------- wiring ---------- */
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () {
      tab = b.dataset.tab;
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("active", x === b); });
      sbWrap.hidden = tab !== "storyboard";
      rodWrap.hidden = tab !== "rodaje";
      renderBottom();
    });
  });
  [sbWrap, rodWrap].forEach(function (w) {
    w.addEventListener("click", function (e) {
      if (!PV.project || e.target.closest("input")) return;
      var n = e.target.closest("[data-id]");
      if (!n) return;
      var i = PV.indexById(PV.project.shots, n.dataset.id);
      if (i < 0) return;
      PV.select("shot", n.dataset.id);
      PV.seek(PV.project.shots[i].start);
    });
  });
  document.addEventListener("paste", function (e) {
    var t = e.target;
    if (!PV.project || PV.selection.kind !== "shot" || (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable))) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
        e.preventDefault();
        processImage(items[i].getAsFile(), PV.selection.id);
        return;
      }
    }
  });

  PV.on("change", function (data) {
    if (!PV.project) return;
    if (!(data && data.light)) renderInspector();
    renderMonitor();
    renderBottom();
    readout();
  });
  PV.on("select", function () {
    renderInspector();
    markSelection();
    var n = PV.selection.kind === "shot" ? sbWrap.querySelector('.card[data-id="' + PV.selection.id + '"]') : null;
    if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
  });
  PV.on("time", function () {
    if (!PV.project) return;
    readout();
    if (monitorKey() !== lastMon) renderMonitor();
    markCurrent(false);
  });
})();
