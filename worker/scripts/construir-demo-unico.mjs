// Empaqueta la DEMO del asesor en UN solo archivo HTML (sin servidor, sin API, sin gestor).
// Reutiliza tal cual engine.js, vista.js, app.js y asesor.css; solo incrusta demo.json, el logo y la tipografía.
//   node scripts/construir-demo-unico.mjs <archivo-de-salida.html>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const A = f => fileURLToPath(new URL("../../asesor/" + f, import.meta.url));
const txt = f => readFileSync(A(f), "utf8"), b64 = f => readFileSync(A(f)).toString("base64");
export function construirUnico() {
  const demo = JSON.stringify(JSON.parse(txt("demo.json")));
  const css = txt("asesor.css").replace("url(assets/Mostwasted.ttf)", `url(data:font/ttf;base64,${b64("assets/Mostwasted.ttf")})`);
  const sinModulos = s => s.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  const js = [txt("engine.js"), txt("vista.js"), txt("app.js")].map(sinModulos).join("\n");
  const logo = `data:image/jpeg;base64,${b64("assets/logo.jpg")}`;
  const shim = `const DEMO_JSON = ${demo};
const _fetch = window.fetch.bind(window), _json = (o, st = 200) => Promise.resolve(new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json" } }));
window.fetch = (u, ...r) => u === "demo.json" ? _json(DEMO_JSON) : u === "config.json" ? _json({ demo: true }) : String(u).startsWith("assets/") ? _json({}, 404) : _fetch(u, ...r);`;
  return `<title>Asesor de Imagen Las Vegas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@500;700&display=swap">
<style>
${css}
/* ajustes para el visor */
.wrap{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.demo{top:env(safe-area-inset-top,0px)}
</style>
<div id="demo" class="demo" role="note" hidden>MODO DEMO · datos inventados para probar · NO son información profesional ni están aprobados</div>
<div class="wrap">
  <div class="barra"><img src="${logo}" alt=""><b>LAS VEGAS</b></div>
  <main id="app" tabindex="-1"></main>
</div>
<script type="module">
${shim}
${js.replaceAll("assets/logo.jpg", logo)}
</script>
`;
}
if (process.argv[1] && process.argv[1].endsWith("construir-demo-unico.mjs")) { const out = process.argv[2]; if (!out) { console.error("Indicá el archivo de salida"); process.exit(1); } const h = construirUnico(); writeFileSync(out, h); console.log("Demo única:", out, Math.round(h.length / 1024) + " KB"); }
