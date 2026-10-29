import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.js";
import { crearD1 } from "../dev/d1-shim.mjs";
import { construir, ARCHIVOS_DEMO } from "../scripts/construir-demo.mjs";
import { generarSecreto } from "../scripts/configurar-secretos.mjs";
import { recomendar } from "../../asesor/engine.js";
import { PASS, cliente, nuevoEnv } from "./_ayuda.mjs";

const leer = p => readFileSync(new URL(p, import.meta.url), "utf8");
const toml = leer("../wrangler.toml");

test("wrangler.toml apunta SOLO a la base lasvegas-asesor-demo y no toca dominios ni otros servicios", () => {
  assert.match(toml, /^name = "lasvegas-asesor-demo"/m);
  assert.match(toml, /database_name = "lasvegas-asesor-demo"/); assert.match(toml, /database_id = "ea9dc45d-6a44-400d-9407-7ea9d1b5e095"/);
  assert.equal((toml.match(/\[\[d1_databases\]\]/g) || []).length, 1, "una sola base");
  assert.doesNotMatch(toml, /^\s*(routes?|zone_id|pattern|custom_domain)\b/m, "sin dominios ni rutas");
  assert.doesNotMatch(toml, /^\[\[(r2_buckets|ai|kv_namespaces|queues|services|vectorize)/m, "sin servicios adicionales");
  assert.doesNotMatch(toml, /gh3/i); assert.match(toml, /GESTOR_HABILITADO = "0"/);
  assert.doesNotMatch(toml, /(PASSWORD|SECRET|TOKEN)[A-Z_]*\s*=\s*"[^"]{8,}"/, "sin secretos en el archivo");
});
test("migraciones: orden 0001..0004 correlativo, sin sentencias destructivas", () => {
  const f = readdirSync(new URL("../migrations/", import.meta.url)).filter(x => x.endsWith(".sql")).sort();
  assert.deepEqual(f.map(x => x.slice(0, 4)), ["0001", "0002", "0003", "0004"]);
  for (const x of f) { const sql = leer("../migrations/" + x).replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|INDEX|TRIGGER|VIEW)\b/i, x); assert.doesNotMatch(sql, /\bTRUNCATE\b/i, x);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, x); assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME)\b/i, x); assert.doesNotMatch(sql, /\bPRAGMA\b/i, x); }
});
test("las migraciones crean 13 tablas y 16 borradores no verificados ni publicados", async () => {
  const db = crearD1(); const t = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).results.map(r => r.name).sort();
  assert.deepEqual(t, ["afirmaciones", "auditoria", "cortes", "evidencias", "fuentes", "imagenes", "intentos_login", "inv_fuentes", "investigaciones", "revisiones", "uso_diario", "variantes", "versiones_ficha"]);
  const c = await db.prepare("SELECT COUNT(*) n, SUM(estado='borrador') b, SUM(publicado) p FROM cortes").first(); assert.deepEqual({ ...c }, { n: 16, b: 16, p: 0 });
});

test("la demo pública se construye con lista blanca: sin gestor, sin investigación, sin Supabase", () => {
  const d = construir(mkdtempSync(join(tmpdir(), "lv-demo-")));
  const todos = []; (function rec(p) { for (const e of readdirSync(p)) { const q = join(p, e); statSync(q).isDirectory() ? rec(q) : todos.push(q); } })(d);
  for (const prohibido of ["gestor.html", "gestor.js", "investigacion.js", "catalogo.json"]) assert.ok(!todos.some(x => x.endsWith(prohibido)), prohibido);
  assert.ok(existsSync(join(d, "index.html")) && existsSync(join(d, "demo.json")) && existsSync(join(d, "_headers")));
  assert.deepEqual(JSON.parse(readFileSync(join(d, "config.json"), "utf8")), { demo: true });
  for (const f of todos.filter(x => /\.(html|js|json|css)$/.test(x))) { const t = readFileSync(f, "utf8");
    assert.doesNotMatch(t, /supabase|fabakotf|canjear|claim_ticket|staff_login|lv-pin/i, "referencia a tickets/Supabase en " + f);
    assert.doesNotMatch(t, /\/api\/admin/, "referencia al gestor en " + f); }
  assert.ok(ARCHIVOS_DEMO.every(f => !/gestor|investigacion/.test(f)));
});
test("el contenido de la demo está separado y todo marcado como DEMO", () => {
  const d = JSON.parse(leer("../../asesor/demo.json")); assert.equal(d.demo, true); assert.equal(d.cortes.length, 3);
  for (const c of d.cortes) { assert.match(c.nombre, /^\[DEMO\]/); assert.match(c.descripcion, /DEMO/); assert.deepEqual(c.imagenes, []);
    for (const f of c.fuentes) { assert.match(f.autor, /DEMO/); assert.match(f.url, /\.invalid\//); } for (const v of c.variantes) assert.match(v.nombre, /^\[DEMO\]/); }
  const perfil = x => recomendar(x, d.cortes).recomendaciones.map(r => r.corte.slug);
  assert.equal(perfil({ pelo: "lacio", largo: "corto", estilo: "moderno", laterales: "degradado", altura: "bajo", transicion: "estirada", tiempo: "poco" })[0], "demo-corte-a");
  assert.equal(perfil({ pelo: "rizado", largo: "largo", estilo: "atrevido", laterales: "tijera", tiempo: "mucho" })[0], "demo-corte-b");
  assert.equal(perfil({ pelo: "ondulado", largo: "muy_corto", estilo: "clasico", laterales: "degradado", altura: "alto", transicion: "comprimida", tiempo: "medio" })[0], "demo-corte-c");
  assert.equal(perfil({ pelo: "ondulado", largo: "corto", estilo: "natural", laterales: "degradado", altura: "medio", transicion: "equilibrada", tiempo: "medio" }).length, 3, "un recorrido típico muestra tres opciones");
});
test("la app pública abre en modo demo por config.json y nunca muestra la demo como ficha verificada", () => {
  assert.match(leer("../../asesor/app.js"), /config\.demo === true/); assert.match(leer("../../asesor/vista.js"), /Ejemplo de prueba · no verificado/);
});

test("con el gestor apagado (demo pública) toda la API privada responde 404, incluso con la contraseña correcta", async () => {
  const env = await nuevoEnv({ GESTOR_HABILITADO: "0" }), c = cliente(env);
  for (const [m, p] of [["POST", "/api/admin/login"], ["GET", "/api/admin/me"], ["GET", "/api/admin/cortes"], ["POST", "/api/admin/cortes"], ["GET", "/api/admin/investigaciones"], ["POST", "/api/admin/investigaciones"], ["POST", "/api/admin/cortes/1/publicar"], ["POST", "/api/admin/investigaciones/1/aprobar"]])
    assert.equal((await c.call(m, p, m === "POST" ? { password: PASS } : undefined)).status, 404, p);
  assert.equal((await c.call("GET", "/api/cortes")).status, 200);
  const rec = await c.call("POST", "/api/recomendar", { pelo: "lacio" }); assert.equal(rec.data.estado, "sin_verificadas", "fichas sin verificar: ninguna recomendación real");
  assert.equal((await c.call("GET", "/api/cortes")).data.length, 16);
});

// ---- todas las rutas privadas exigen sesión (con el gestor habilitado) ----
const RUTAS = [["GET", "/api/admin/me"], ["GET", "/api/admin/cortes"], ["POST", "/api/admin/cortes"], ["GET", "/api/admin/cortes/1"], ["PUT", "/api/admin/cortes/1"], ["POST", "/api/admin/cortes/1/estado"], ["POST", "/api/admin/cortes/1/publicar"],
  ["POST", "/api/admin/cortes/1/variantes"], ["PUT", "/api/admin/variantes/1"], ["DELETE", "/api/admin/variantes/1"], ["POST", "/api/admin/cortes/1/fuentes"], ["PUT", "/api/admin/fuentes/1"], ["DELETE", "/api/admin/fuentes/1"], ["POST", "/api/admin/fuentes/1/revisar"],
  ["POST", "/api/admin/cortes/1/imagenes"], ["GET", "/api/admin/imagenes/1"], ["DELETE", "/api/admin/imagenes/1"], ["POST", "/api/admin/logout"], ["GET", "/api/admin/cortes/1/versiones"],
  ["GET", "/api/admin/investigaciones"], ["POST", "/api/admin/investigaciones"], ["GET", "/api/admin/investigaciones/capacidades"], ["GET", "/api/admin/investigaciones/1"], ["POST", "/api/admin/investigaciones/1/estado"], ["POST", "/api/admin/investigaciones/1/fuentes"],
  ["DELETE", "/api/admin/investigaciones/fuentes/1"], ["POST", "/api/admin/investigaciones/fuentes/1/leida"], ["POST", "/api/admin/investigaciones/fuentes/1/validar"], ["POST", "/api/admin/investigaciones/1/afirmaciones"],
  ["PUT", "/api/admin/investigaciones/afirmaciones/1"], ["DELETE", "/api/admin/investigaciones/afirmaciones/1"], ["POST", "/api/admin/investigaciones/afirmaciones/1/evidencias"], ["DELETE", "/api/admin/investigaciones/evidencias/1"],
  ["POST", "/api/admin/investigaciones/1/buscar"], ["POST", "/api/admin/investigaciones/1/proponer"], ["POST", "/api/admin/investigaciones/1/aprobar"]];
test("ninguna ruta privada funciona sin sesión, ni con sesión falsa, y las escrituras piden CSRF", async () => {
  const env = await nuevoEnv(), anon = cliente(env), falso = cliente(env); falso.cookie = "lv_sesion=abc.def";
  for (const [m, p] of RUTAS) for (const c of [anon, falso]) assert.equal((await c.call(m, p, m === "GET" ? undefined : {})).status, 401, m + " " + p);
  const ok = cliente(env); await ok.login(PASS); ok.sinCsrf = true;
  for (const [m, p] of RUTAS.filter(r => r[0] !== "GET" && !r[1].endsWith("imagenes"))) assert.equal((await ok.call(m, p, {})).status, 403, "sin CSRF: " + m + " " + p);
  assert.equal((await ok.call("GET", "/api/admin/me")).status, 200);
});
test("editor no aprueba, no verifica, no publica, no revisa ni valida (todas las rutas de decisión)", async () => {
  const { dosRoles } = await import("./_ayuda.mjs"); const { ed } = await dosRoles();
  const inv = (await ed.call("POST", "/api/admin/investigaciones", { nombre: "Corte Permisos" })).data;
  const f = (await ed.call("POST", `/api/admin/investigaciones/${inv.id}/fuentes`, { autor: "A", url: "https://ejemplo.invalid/p" })).data.fuentes[0];
  for (const [m, p] of [["POST", "/api/admin/cortes/1/publicar"], ["POST", "/api/admin/fuentes/1/revisar"], ["POST", `/api/admin/investigaciones/fuentes/${f.id}/validar`]]) assert.equal((await ed.call(m, p, {})).status, 403, p);
  assert.equal((await ed.call("POST", "/api/admin/cortes/1/estado", { estado: "verificado", confirmo_revision: true })).status, 403);
  assert.equal((await ed.call("POST", `/api/admin/investigaciones/${inv.id}/aprobar`, { confirmo: true })).status, 403);
});
test("generador de secretos: largo suficiente y distinto cada vez", () => { const a = generarSecreto(), b = generarSecreto(); assert.ok(a.length >= 48 && a !== b); });
test("el worker no contiene contraseñas ni claves de desarrollo escritas a mano", () => {
  for (const f of ["../src/index.js", "../src/auth.js", "../src/investigacion.js", "../src/proveedores.js"]) assert.doesNotMatch(leer(f), /las-vegas-dev|eyJhbGci|sk-[A-Za-z0-9]{20}/, f);
});
