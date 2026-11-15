#!/usr/bin/env node
// Junta planificador/ (HTML + CSS + JS) en un único archivo HTML que se abre con doble clic.
//   node scripts/bundle-planificador.cjs            -> planificador/Planificador-videoclips.html
//   node scripts/bundle-planificador.cjs --artifact <salida>
//        versión para publicar como página web (sin <html>/<head>/<body> y sin los botones
//        que el visor web no permite: Guardar, CSV e Imprimir)
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "planificador");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const artifact = process.argv[2] === "--artifact";
const out = artifact ? process.argv[3] : path.join(dir, "Planificador-videoclips.html");
if (!out) { console.error("Falta la ruta de salida"); process.exit(1); }

let html = read("index.html");
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");

html = html.replace(/<link rel="stylesheet" href="style.css">/, () => "<style>\n" + read("style.css") + "\n</style>");
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => "<script>\n" + safe(read(src)) + "\n</script>");

if (artifact) {
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || [""])[0];
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  const extra = "<style>#btn-save,#btn-csv,#btn-print{display:none!important}" +
    "html,body{height:100%}body{height:100%!important}</style>";
  html = title + "\n" + style + "\n" + extra + "\n" + body;
}

fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024).toFixed(1) + " KB");
