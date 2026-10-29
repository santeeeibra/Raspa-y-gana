import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { crearHash } from "../src/auth.js";
import { crearD1 } from "../dev/d1-shim.mjs";

const env = { DB: crearD1(), DEV: "1", ADMIN_PASSWORD_HASH: await crearHash("contraseña-de-prueba-123", 1000), SESSION_SECRET: "x".repeat(40) };
let cookie = "";
const call = async (m, p, b, extra = {}) => {
  const h = { cookie, ...extra }; let body;
  if (b instanceof FormData) body = b; else if (b !== undefined && m !== "GET") { body = JSON.stringify(b); h["content-type"] = "application/json"; }
  const r = await worker.fetch(new Request("http://x.test" + p, { method: m, headers: h, body }), env);
  const sc = r.headers.get("set-cookie"); if (sc && p.endsWith("login")) cookie = sc.split(";")[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};

test("el público ve 16 borradores solo con nombre y estado", async () => {
  const { data } = await call("GET", "/api/cortes");
  assert.equal(data.length, 16);
  assert.deepEqual(Object.keys(data[0]).sort(), ["estado", "nombre", "slug"]);
  assert.ok(data.every(c => c.estado === "borrador"));
});
test("recomendar sin fichas verificadas devuelve el aviso", async () => {
  const { data } = await call("POST", "/api/recomendar", { pelo: "lacio" });
  assert.equal(data.estado, "sin_verificadas");
});
test("sin sesión el gestor está cerrado", async () => {
  for (const [m, p, b = {}] of [["GET", "/api/admin/cortes", undefined], ["POST", "/api/admin/cortes"], ["PUT", "/api/admin/cortes/1"], ["POST", "/api/admin/cortes/1/estado"]])
    assert.equal((await call(m, p, b)).status, 401, p);
});
test("login: contraseña mala falla y se bloquea tras 5 intentos", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/api/admin/login", { password: "mala" })).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { password: "contraseña-de-prueba-123" })).status, 429);
  env.DB.prepare("DELETE FROM intentos_login").run();
  assert.equal((await call("POST", "/api/admin/login", { password: "contraseña-de-prueba-123" })).status, 200);
  assert.ok(cookie.startsWith("lv_sesion="));
});
test("rechaza peticiones de otro origen", async () => {
  assert.equal((await call("POST", "/api/admin/cortes", { nombre: "X" }, { origin: "http://malo.test" })).status, 403);
});
let id;
test("flujo completo: crear, completar, no verificar sin fuente, verificar, publicar", async () => {
  let r = await call("POST", "/api/admin/cortes", { nombre: "Corte Prueba" }); assert.equal(r.status, 201); id = r.data.id;
  assert.equal((await call("POST", "/api/admin/cortes", { nombre: "Corte Prueba" })).status, 409);
  assert.equal((await call("PUT", `/api/admin/cortes/${id}`, { pelos: ["cuadrado"] })).status, 400); // valor inventado
  r = await call("PUT", `/api/admin/cortes/${id}`, { descripcion: "d", pelos: ["lacio"], largos: ["corto"], estilos: ["moderno"], publicado: true });
  assert.equal(r.status, 200);
  assert.equal((await call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true })).status, 422);
  await call("POST", `/api/admin/cortes/${id}/estado`, { estado: "pendiente" });
  r = await call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal(r.status, 422); assert.ok(r.data.faltan.some(f => /fuente/.test(f)));
  assert.equal((await call("POST", `/api/admin/cortes/${id}/fuentes`, { autor: "A", url: "http://inseguro.com" })).status, 400);
  assert.equal((await call("POST", `/api/admin/cortes/${id}/fuentes`, { autor: "A", url: "https://ejemplo.invalid/x", afirmacion: "dato" })).status, 201);
  assert.equal((await call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado" })).status, 422); // falta confirmar revisión
  r = await call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal(r.status, 200); assert.equal(r.data.estado, "verificado");
  const pub = (await call("GET", "/api/cortes")).data.find(c => c.slug === "corte-prueba");
  assert.equal(pub.fuentes[0].autor, "A"); assert.ok(!("notas_internas" in pub));
  const rec = await call("POST", "/api/recomendar", { pelo: "lacio", largo: "corto" });
  assert.equal(rec.data.estado, "ok"); assert.equal(rec.data.recomendaciones[0].corte.slug, "corte-prueba");
});
test("la base impide verificar sin fuente y borrar la última fuente", async () => {
  const f = (await call("GET", `/api/admin/cortes/${id}`)).data.fuentes[0];
  assert.equal((await call("DELETE", `/api/admin/fuentes/${f.id}`)).status, 409);
  await assert.rejects(env.DB.prepare("UPDATE cortes SET estado='verificado' WHERE slug='low-fade-texturizado'").run(), /verificado_requiere_fuente/);
});
test("editar una ficha verificada la devuelve a «pendiente»", async () => {
  const r = await call("PUT", `/api/admin/cortes/${id}`, { descripcion: "otra" });
  assert.equal(r.data.estado, "pendiente");
  assert.equal((await call("POST", "/api/recomendar", { pelo: "lacio" })).data.estado, "sin_verificadas");
});
test("retirar un corte lo saca del catálogo", async () => {
  await call("PUT", `/api/admin/cortes/${id}`, { publicado: false });
  assert.ok(!(await call("GET", "/api/cortes")).data.some(c => c.slug === "corte-prueba"));
});
test("subir fotos exige R2, derechos y confirmar que no son de clientes", async () => {
  const fd = new FormData(); fd.set("archivo", new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0])]), "a.jpg");
  assert.equal((await call("POST", `/api/admin/cortes/${id}/imagenes`, fd)).status, 501); // sin R2 configurado
  const blobs = new Map(); env.IMAGENES = { put: async (k, v) => blobs.set(k, v), delete: async k => blobs.delete(k), get: async () => null };
  assert.equal((await call("POST", `/api/admin/cortes/${id}/imagenes`, fd)).status, 400);
  fd.set("confirmo_sin_clientes", "1"); assert.equal((await call("POST", `/api/admin/cortes/${id}/imagenes`, fd)).status, 400); // falta derechos
  fd.set("derechos", "Foto propia del local"); assert.equal((await call("POST", `/api/admin/cortes/${id}/imagenes`, fd)).status, 201);
  const mal = new FormData(); mal.set("archivo", new Blob(["<script>"]), "a.jpg"); mal.set("derechos", "x"); mal.set("confirmo_sin_clientes", "1");
  assert.equal((await call("POST", `/api/admin/cortes/${id}/imagenes`, mal)).status, 415);
  assert.equal(blobs.size, 1);
});
test("cerrar sesión", async () => {
  assert.equal((await call("POST", "/api/admin/logout", {})).status, 200);
});
