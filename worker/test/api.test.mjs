import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { crearHash } from "../src/auth.js";
import { _reiniciarLimites } from "../src/limites.js";
import { crearD1 } from "../dev/d1-shim.mjs";

const PASS = "contraseña-de-prueba-123", PASS_REV = "otra-contraseña-revisor-456";
const nuevoEnv = async (extra = {}) => ({ DB: crearD1(), DEV: "1", ADMIN_PASSWORD_HASH: await crearHash(PASS, 1000), SESSION_SECRET: "x".repeat(40), ...extra });
const env = await nuevoEnv();

/** Cliente de prueba: guarda cookie y token CSRF como lo hace el navegador. */
const cliente = (e = env) => {
  const c = { cookie: "", csrf: "" };
  c.call = async (m, p, b, extra = {}) => {
    const h = { ...(c.cookie ? { cookie: c.cookie } : {}), ...extra }; let body;
    if (m !== "GET" && c.csrf && !("x-csrf-token" in h) && !c.sinCsrf) h["x-csrf-token"] = c.csrf;
    if (b instanceof FormData) { const r = new Response(b); h["content-type"] = r.headers.get("content-type"); body = await r.arrayBuffer(); h["content-length"] ??= String(body.byteLength); }
    else if (b !== undefined && m !== "GET") { body = typeof b === "string" ? b : JSON.stringify(b); h["content-type"] ??= "application/json"; }
    const r = await worker.fetch(new Request("http://x.test" + p, { method: m, headers: h, body }), e);
    const sc = r.headers.get("set-cookie"); if (sc && p.endsWith("login")) c.cookie = sc.split(";")[0];
    const data = await r.json().catch(() => null);
    if (p.endsWith("login") && data?.csrf) c.csrf = data.csrf;
    return { status: r.status, data, headers: r.headers };
  };
  c.login = pw => c.call("POST", "/api/admin/login", { password: pw });
  return c;
};
const a = cliente();
const nuevoCorte = async (cl, nombre) => (await cl.call("POST", "/api/admin/cortes", { nombre })).data;
const completar = (cl, id) => cl.call("PUT", `/api/admin/cortes/${id}`, { descripcion: "d", pelos: ["lacio"], largos: ["corto"], estilos: ["moderno"] });
const fuenteOk = (cl, id) => cl.call("POST", `/api/admin/cortes/${id}/fuentes`, { autor: "A", url: "https://ejemplo.invalid/x", afirmacion: "dato" });
async function verificadoYPublicado(cl, nombre) {
  const c = await nuevoCorte(cl, nombre); await completar(cl, c.id);
  const f = (await fuenteOk(cl, c.id)).data.fuentes[0];
  await cl.call("POST", `/api/admin/cortes/${c.id}/estado`, { estado: "pendiente" });
  await cl.call("POST", `/api/admin/fuentes/${f.id}/revisar`, { revisada: true });
  const v = await cl.call("POST", `/api/admin/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: true }); assert.equal(v.status, 200, JSON.stringify(v.data));
  const p = await cl.call("POST", `/api/admin/cortes/${c.id}/publicar`, { publicado: true, confirmo: true }); assert.equal(p.status, 200, JSON.stringify(p.data));
  return { id: c.id, fuenteId: f.id };
}

// ---------- público ----------
test("el público ve 16 borradores solo con nombre y estado", async () => {
  const { data } = await a.call("GET", "/api/cortes");
  assert.equal(data.length, 16);
  assert.deepEqual(Object.keys(data[0]).sort(), ["estado", "nombre", "slug"]);
});
test("recomendar sin fichas verificadas devuelve el aviso", async () => {
  assert.equal((await a.call("POST", "/api/recomendar", { pelo: "lacio" })).data.estado, "sin_verificadas");
});

// ---------- acceso y CSRF ----------
test("sin sesión el gestor está cerrado", async () => {
  for (const [m, p, b] of [["GET", "/api/admin/cortes"], ["POST", "/api/admin/cortes", {}], ["PUT", "/api/admin/cortes/1", {}], ["POST", "/api/admin/cortes/1/estado", {}], ["POST", "/api/admin/cortes/1/publicar", {}], ["POST", "/api/admin/fuentes/1/revisar", {}]])
    assert.equal((await a.call(m, p, b)).status, 401, p);
});
test("login: contraseña mala falla; el límite por IP bloquea al 5.º fallo", async () => {
  _reiniciarLimites();
  for (let i = 0; i < 5; i++) assert.equal((await a.login("mala")).status, 401);
  const r = await a.login(PASS); assert.equal(r.status, 429); assert.ok(r.headers.get("retry-after"));
  await env.DB.prepare("DELETE FROM intentos_login").run();
  const ok = await a.login(PASS); assert.equal(ok.status, 200); assert.ok(a.cookie.startsWith("lv_sesion=")); assert.ok(a.csrf.length > 20);
});
test("login exige JSON y origen propio", async () => {
  const b = cliente();
  assert.equal((await b.call("POST", "/api/admin/login", `password=${PASS}`, { "content-type": "application/x-www-form-urlencoded" })).status, 400);
  assert.equal((await b.call("POST", "/api/admin/login", { password: PASS }, { origin: "http://malo.test" })).status, 403);
  assert.equal((await b.call("POST", "/api/admin/login", { password: PASS }, { "sec-fetch-site": "cross-site" })).status, 403);
});
test("CSRF: toda escritura exige token, incluso SIN encabezado Origin", async () => {
  const b = cliente(); await b.login(PASS); b.sinCsrf = true;
  for (const [m, p, body] of [["POST", "/api/admin/cortes", { nombre: "X" }], ["PUT", "/api/admin/cortes/1", { nombre: "X" }], ["POST", "/api/admin/cortes/1/estado", { estado: "pendiente" }],
    ["POST", "/api/admin/cortes/1/publicar", { publicado: false }], ["POST", "/api/admin/cortes/1/variantes", { nombre: "v" }], ["POST", "/api/admin/cortes/1/fuentes", {}],
    ["POST", "/api/admin/fuentes/1/revisar", {}], ["DELETE", "/api/admin/fuentes/1"], ["DELETE", "/api/admin/imagenes/1"], ["POST", "/api/admin/logout", {}]])
    assert.equal((await b.call(m, p, body)).status, 403, m + " " + p);
  assert.equal((await b.call("POST", "/api/admin/cortes", { nombre: "X" }, { "x-csrf-token": "inventado" })).status, 403);
  assert.equal((await b.call("GET", "/api/admin/cortes")).status, 200); // leer no cambia nada
  b.sinCsrf = false; assert.equal((await b.call("POST", "/api/admin/cortes", { nombre: "Con token" })).status, 201);
});
test("el token CSRF de una sesión no sirve en otra", async () => {
  const x = cliente(), y = cliente(); await x.login(PASS); await y.login(PASS);
  assert.equal((await x.call("POST", "/api/admin/cortes", { nombre: "Otro" }, { "x-csrf-token": y.csrf })).status, 403);
});
test("el gestor no acepta CORS ni preflight", async () => {
  const r = await worker.fetch(new Request("http://x.test/api/admin/cortes", { method: "OPTIONS", headers: { origin: "https://evil.test" } }), env);
  assert.equal(r.status, 405); assert.equal(r.headers.get("access-control-allow-origin"), null);
});
test("cookie de producción: __Host-, HttpOnly, Secure, SameSite=Strict, Path=/", async () => {
  const prod = await nuevoEnv({ DEV: "0" });
  const r = await worker.fetch(new Request("http://x.test/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASS }) }), prod);
  const c = r.headers.get("set-cookie"); assert.match(c, /^__Host-lv_sesion=/);
  for (const t of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(c.includes(t), t); assert.ok(!/Domain=/i.test(c));
});
test("la sesión adulterada o vencida no sirve", async () => {
  const b = cliente(); await b.login(PASS); b.cookie = b.cookie.slice(0, -3) + "AAA";
  assert.equal((await b.call("GET", "/api/admin/cortes")).status, 401);
});

// ---------- separación de funciones ----------
let id, fuenteId;
test("editor no puede revisar, verificar ni publicar; revisor sí", async () => {
  const e2 = await nuevoEnv({ REVISOR_PASSWORD_HASH: await crearHash(PASS_REV, 1000) });
  const ed = cliente(e2), rev = cliente(e2);
  assert.equal((await ed.login(PASS)).data.rol, "editor"); assert.equal((await rev.login(PASS_REV)).data.rol, "revisor");
  const c = await nuevoCorte(ed, "Corte Roles"); await completar(ed, c.id);
  const f = (await fuenteOk(ed, c.id)).data.fuentes[0];
  assert.equal((await ed.call("POST", `/api/admin/cortes/${c.id}/estado`, { estado: "pendiente" })).status, 200);
  assert.equal((await ed.call("POST", `/api/admin/fuentes/${f.id}/revisar`, { revisada: true })).status, 403);
  assert.equal((await ed.call("POST", `/api/admin/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: true })).status, 403);
  assert.equal((await ed.call("POST", `/api/admin/cortes/${c.id}/publicar`, { publicado: true, confirmo: true })).status, 403);
  assert.equal((await rev.call("POST", `/api/admin/fuentes/${f.id}/revisar`, { revisada: true })).status, 200);
  assert.equal((await rev.call("POST", `/api/admin/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: true })).status, 200);
  assert.equal((await rev.call("POST", `/api/admin/cortes/${c.id}/publicar`, { publicado: true, confirmo: true })).status, 200);
});
test("flujo en tres pasos: fuente revisada → ficha verificada → ficha publicada", async () => {
  let r = await a.call("POST", "/api/admin/cortes", { nombre: "Corte Prueba" }); assert.equal(r.status, 201); id = r.data.id;
  assert.equal((await a.call("POST", "/api/admin/cortes", { nombre: "Corte Prueba" })).status, 409);
  assert.equal((await a.call("PUT", `/api/admin/cortes/${id}`, { pelos: ["cuadrado"] })).status, 400);
  assert.equal((await completar(a, id)).status, 200);
  await a.call("PUT", `/api/admin/cortes/${id}`, { publicado: true });                       // PUT ya no publica
  assert.equal((await a.call("GET", `/api/admin/cortes/${id}`)).data.publicado, 0);
  await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "pendiente" });
  r = await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal(r.status, 422); assert.ok(r.data.faltan.some(f => /fuente/.test(f)));
  assert.equal((await a.call("POST", `/api/admin/cortes/${id}/fuentes`, { autor: "A", url: "http://inseguro.com" })).status, 400);
  fuenteId = (await fuenteOk(a, id)).data.fuentes[0].id;
  r = await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal(r.status, 422); assert.ok(r.data.faltan.some(f => /sin marcar como revisadas/.test(f)));
  await a.call("POST", `/api/admin/fuentes/${fuenteId}/revisar`, { revisada: true });
  assert.equal((await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado" })).status, 422);       // falta confirmar
  r = await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal(r.status, 200); assert.equal(r.data.estado, "verificado");
  assert.ok(!(await a.call("GET", "/api/cortes")).data.some(c => c.slug === "corte-prueba" && c.fuentes), "verificada pero NO publicada: no sale completa");
  assert.equal((await a.call("POST", "/api/recomendar", { pelo: "lacio" })).data.estado, "sin_verificadas");
  assert.equal((await a.call("POST", `/api/admin/cortes/${id}/publicar`, { publicado: true })).status, 422);          // falta confirmar
  assert.equal((await a.call("POST", `/api/admin/cortes/${id}/publicar`, { publicado: true, confirmo: true })).status, 200);
  const rec = await a.call("POST", "/api/recomendar", { pelo: "lacio", largo: "corto" });
  assert.equal(rec.data.estado, "ok"); assert.equal(rec.data.recomendaciones[0].corte.slug, "corte-prueba");
});
test("la base también impide saltarse los pasos", async () => {
  await assert.rejects(env.DB.prepare("UPDATE cortes SET estado='verificado' WHERE slug='low-fade-texturizado'").run(), /verificado_requiere_fuente/);
  await assert.rejects(env.DB.prepare("UPDATE cortes SET publicado=1 WHERE slug='low-fade-texturizado'").run(), /publicar_requiere_verificado/);
  const c = await nuevoCorte(a, "Sin revisar"); await fuenteOk(a, c.id);
  await assert.rejects(env.DB.prepare("UPDATE cortes SET estado='verificado' WHERE id=?1").bind(c.id).run(), /fuentes_sin_revisar/);
});
test("no se puede borrar la última fuente de una ficha verificada", async () => {
  assert.equal((await a.call("DELETE", `/api/admin/fuentes/${fuenteId}`)).status, 409);
});
test("editar una fuente quita su revisión; editar la ficha la quita del público", async () => {
  let r = await a.call("PUT", `/api/admin/fuentes/${fuenteId}`, { autor: "A", url: "https://ejemplo.invalid/y" });
  assert.equal(r.data.fuentes[0].revisada_en, null); assert.equal(r.data.estado, "pendiente"); assert.equal(r.data.publicado, 0);
  assert.equal((await a.call("POST", "/api/recomendar", { pelo: "lacio" })).data.estado, "sin_verificadas");
});
test("verificar de nuevo no republica solo", async () => {
  await a.call("POST", `/api/admin/fuentes/${fuenteId}/revisar`, { revisada: true });
  await a.call("POST", `/api/admin/cortes/${id}/estado`, { estado: "verificado", confirmo_revision: true });
  assert.equal((await a.call("GET", `/api/admin/cortes/${id}`)).data.publicado, 0);
  await a.call("POST", `/api/admin/cortes/${id}/publicar`, { publicado: true, confirmo: true });
  await a.call("POST", `/api/admin/cortes/${id}/publicar`, { publicado: false });
  assert.ok(!(await a.call("GET", "/api/cortes")).data.some(c => c.slug === "corte-prueba"), "retirada: invisible");
});

// ---------- información interna ----------
test("nada interno llega al público (catálogo ni recomendaciones)", async () => {
  const b = cliente(); await b.login(PASS);
  const { id: cid } = await verificadoYPublicado(b, "Ficha Secreta");
  await b.call("PUT", `/api/admin/cortes/${cid}`, { notas_internas: "SECRETO-INTERNO-123" });       // vuelve a pendiente…
  const f = (await b.call("GET", `/api/admin/cortes/${cid}`)).data.fuentes[0];
  await b.call("POST", `/api/admin/cortes/${cid}/estado`, { estado: "pendiente" });
  await b.call("POST", `/api/admin/fuentes/${f.id}/revisar`, { revisada: true });
  await b.call("POST", `/api/admin/cortes/${cid}/estado`, { estado: "verificado", confirmo_revision: true });
  await b.call("POST", `/api/admin/cortes/${cid}/publicar`, { publicado: true, confirmo: true });
  const cat = await b.call("GET", "/api/cortes"), rec = await b.call("POST", "/api/recomendar", { pelo: "lacio", largo: "corto" });
  for (const t of [JSON.stringify(cat.data), JSON.stringify(rec.data)]) {
    for (const prohibido of ["SECRETO-INTERNO-123", "notas_internas", "verificado_por", "revisada_por", "revisada_en", "corte_id", "r2_key", "derechos", "creado_en", "actualizado_en", "intentos", "auditoria"])
      assert.ok(!t.includes(prohibido), "se filtró: " + prohibido);
  }
  assert.ok(cat.data.find(c => c.slug === "ficha-secreta").fuentes);
});

// ---------- abuso y tamaños ----------
test("recomendar: límite de solicitudes y entradas ajenas ignoradas", async () => {
  _reiniciarLimites();
  const r = await a.call("POST", "/api/recomendar", { pelo: "lacio", __proto__x: "1", rostro: "redondo", largo: "<script>" });
  assert.equal(r.status, 200);
  let ultimo; for (let i = 0; i < 31; i++) ultimo = await a.call("POST", "/api/recomendar", { pelo: "lacio" });
  assert.equal(ultimo.status, 429); assert.ok(ultimo.headers.get("retry-after"));
  _reiniciarLimites();
});
test("el bloqueo global de login frena ataques repartidos entre IPs", async () => {
  const e2 = await nuevoEnv(); const cl = cliente(e2);
  for (let i = 0; i < 30; i++) { const ip = "9.9.9." + i; await cl.call("POST", "/api/admin/login", { password: "mala" }, { "cf-connecting-ip": ip }); }
  assert.equal((await cl.call("POST", "/api/admin/login", { password: PASS }, { "cf-connecting-ip": "1.2.3.4" })).status, 429);
});
test("JSON demasiado grande (64 KB) o con tipo equivocado se rechaza", async () => {
  const b = cliente(); await b.login(PASS);
  assert.equal((await b.call("POST", "/api/admin/cortes", { nombre: "x", descripcion: "a".repeat(70000) })).status, 413);
  assert.equal((await b.call("POST", "/api/admin/cortes", "nombre=x", { "content-type": "text/plain" })).status, 400);
});
test("CORS: solo los sitios autorizados leen el catálogo público", async () => {
  const e2 = await nuevoEnv({ PUBLIC_ORIGINS: "https://lasvegas.vercel.app" });
  const ok = await worker.fetch(new Request("http://x.test/api/cortes", { headers: { origin: "https://lasvegas.vercel.app" } }), e2);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://lasvegas.vercel.app"); assert.equal(ok.headers.get("access-control-allow-credentials"), null);
  const no = await worker.fetch(new Request("http://x.test/api/cortes", { headers: { origin: "https://evil.test" } }), e2);
  assert.equal(no.headers.get("access-control-allow-origin"), null);
});

// ---------- fotos ----------
const jpg = () => new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
const formFoto = (extra = {}) => { const fd = new FormData(); fd.set("archivo", jpg(), "a.jpg"); fd.set("derechos", "Foto propia del local"); fd.set("confirmo_sin_clientes", "1"); for (const [k, v] of Object.entries(extra)) v === null ? fd.delete(k) : fd.set(k, v); return fd; };
test("fotos: exige R2, derechos, confirmación y valida el contenido real", async () => {
  const b = cliente(); await b.login(PASS); const { id: cid } = await nuevoCorte(b, "Con Fotos");
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto())).status, 501);
  const blobs = new Map(); env.IMAGENES = { put: async (k, v) => blobs.set(k, v), delete: async k => blobs.delete(k), get: async () => null };
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto({ confirmo_sin_clientes: null }))).status, 400);
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto({ derechos: null }))).status, 400);
  const mal = formFoto(); mal.set("archivo", new Blob(["<svg onload=alert(1)>"]), "a.jpg");
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, mal)).status, 415);
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto())).status, 201);
  assert.equal(blobs.size, 1);
});
test("fotos: carga excesiva rechazada antes de leerla; sin Content-Length; máximo por corte", async () => {
  const b = cliente(); await b.login(PASS); const { id: cid } = await nuevoCorte(b, "Muchas Fotos");
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto(), { "content-length": String(50 * 1024 * 1024) })).status, 413);
  const grande = formFoto(); grande.set("archivo", new Blob([new Uint8Array(2 * 1024 * 1024 + 10).fill(0xFF)]), "g.jpg");
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, grande)).status, 413);
  const req = new Request("http://x.test/api/admin/cortes/" + cid + "/imagenes", { method: "POST", headers: { cookie: b.cookie, "x-csrf-token": b.csrf, "content-type": "multipart/form-data; boundary=x" }, body: "x" });
  assert.equal((await worker.fetch(req, env)).status, 411);
  for (let i = 0; i < 12; i++) assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto())).status, 201);
  assert.equal((await b.call("POST", `/api/admin/cortes/${cid}/imagenes`, formFoto())).status, 409);
});
test("cerrar sesión", async () => {
  const b = cliente(); await b.login(PASS);
  assert.equal((await b.call("POST", "/api/admin/logout", {})).status, 200);
});
