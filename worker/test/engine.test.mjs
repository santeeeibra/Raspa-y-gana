import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recomendar, esRecomendable, preguntasVisibles } from "../../asesor/engine.js";

const demo = JSON.parse(readFileSync(new URL("../../asesor/demo.json", import.meta.url), "utf8")).cortes;
const base = { pelo: "lacio", largo: "corto", estilo: "moderno", entradas: "cuidar", densidad: "no_se", volumen: "no_se", laterales: "degradado", altura: "bajo", transicion: "estirada", tiempo: "poco" };

test("sin fichas verificadas no recomienda nada y lo dice", () => {
  const r = recomendar(base, [{ ...demo[0], estado: "borrador" }, { ...demo[1], estado: "pendiente" }]);
  assert.equal(r.estado, "sin_verificadas"); assert.equal(r.recomendaciones.length, 0); assert.match(r.mensaje, /no hay fichas verificadas/i);
});
test("una ficha verificada sin fuentes o sin https no es recomendable", () => {
  assert.equal(esRecomendable({ ...demo[0], fuentes: [] }), false);
  assert.equal(esRecomendable({ ...demo[0], fuentes: [{ autor: "x", url: "http://x.com" }] }), false);
  assert.equal(esRecomendable({ ...demo[0], publicado: 0 }), false);
  assert.equal(esRecomendable(demo[0]), true);
});
test("recomienda con explicación y fuentes", () => {
  const r = recomendar(base, demo);
  assert.equal(r.estado, "ok"); assert.equal(r.recomendaciones[0].corte.slug, "demo-corte-a");
  assert.equal(r.recomendaciones[0].puntaje, 100);
  assert.ok(r.recomendaciones[0].razones.every(x => x.texto && x.ok));
  assert.equal(r.recomendaciones[0].respaldo[0].autor, "Autor ficticio");
  assert.equal(r.recomendaciones[0].variante.nombre, "[DEMO] Variante baja");
});
test("descarta cortes incompatibles con el cabello o el largo y explica por qué", () => {
  const r = recomendar({ ...base, pelo: "muy_rizado" }, demo);
  assert.ok(r.descartados.some(d => d.slug === "demo-corte-a" && /muy rizado/i.test(d.motivo)));
});
test("«No sé» no suma ni resta", () => {
  const r = recomendar({ pelo: "lacio", largo: "corto", laterales: "no_se", altura: "no_se", transicion: "no_se" }, demo);
  assert.equal(r.recomendaciones[0].puntaje, 100); assert.equal(r.recomendaciones[0].criteriosEvaluados, 2);
});
test("las preguntas de degradado solo aparecen si corresponde", () => {
  const ids = r => preguntasVisibles(r).map(p => p.id);
  assert.ok(ids({ laterales: "degradado" }).includes("altura") && ids({ laterales: "degradado" }).includes("transicion"));
  assert.ok(ids({}).includes("altura"));
  assert.ok(!ids({ laterales: "tijera" }).includes("altura") && !ids({ laterales: "tijera" }).includes("transicion"));
});
test("no usa la forma del rostro", () => {
  const a = recomendar({ ...base, rostro: "redondo" }, demo), b = recomendar({ ...base, rostro: "alargado" }, demo);
  assert.deepEqual(a.recomendaciones.map(x => x.puntaje), b.recomendaciones.map(x => x.puntaje));
});
test("un dato que la ficha no trae no se inventa: se cuenta como faltante", () => {
  const r = recomendar({ ...base, densidad: "espesa" }, demo);
  assert.equal(r.recomendaciones[0].datosFaltantes, 1);
});
test("devuelve como máximo tres", () => {
  const muchos = Array.from({ length: 6 }, (_, i) => ({ ...demo[0], slug: "c" + i, nombre: "C" + i }));
  assert.equal(recomendar(base, muchos).recomendaciones.length, 3);
});
