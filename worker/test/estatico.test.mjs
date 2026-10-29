import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../../asesor/", import.meta.url);
const archivos = readdirSync(dir).filter(f => /\.(html|js)$/.test(f));

test("la web no usa manejadores en línea ni eval (compatible con la CSP sin 'unsafe-inline' en scripts)", () => {
  for (const f of archivos) {
    const t = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/\son(click|error|load|submit|change|input)\s*=/i.test(t), "manejador en línea en " + f);
    assert.ok(!/\beval\(|new Function\(|document\.write\(/.test(t), "eval/document.write en " + f);
    if (f.endsWith(".html")) assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(t), "script en línea en " + f);
  }
});
test("la CSP del sitio prohíbe scripts externos y marcos", () => {
  const h = readFileSync(new URL("_headers", dir), "utf8");
  assert.match(h, /script-src 'self'(;|$)/m); assert.match(h, /frame-ancestors 'none'/); assert.match(h, /object-src 'none'/);
});
test("ni el gestor ni la web guardan sesión o claves en localStorage", () => {
  for (const f of ["gestor.js", "app.js"]) {
    const t = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/localStorage\.(set|get)Item\(["'](lv-pin|pin|token|csrf|sesion)/i.test(t), f);
  }
  assert.ok(!/localStorage/.test(readFileSync(new URL("gestor.js", dir), "utf8")), "el gestor no usa localStorage");
});
test("el modo demo siempre se identifica como DEMO en la tarjeta", async () => {
  const { tarjeta } = await import("../../asesor/vista.js");
  const x = { corte: { nombre: "[DEMO] X", imagenes: [], variantes: [], fuentes: [] }, razones: [] };
  const html = tarjeta(x, { demo: true });
  assert.match(html, /DEMO · contenido de prueba, no aprobado/); assert.ok(!/Ficha verificada/.test(html));
  assert.match(tarjeta(x, {}), /Ficha verificada/);
});
test("las tarjetas escapan HTML de los datos", async () => {
  const { tarjeta } = await import("../../asesor/vista.js");
  const html = tarjeta({ corte: { nombre: '<img src=x onerror=alert(1)>', imagenes: [], variantes: [], fuentes: [{ autor: "<b>", url: 'https://a.test/"><script>' }] }, razones: [] }, {});
  assert.ok(!/<img src=x/.test(html) && !/<script>/.test(html));
});
