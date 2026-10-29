// API de LAS VEGAS · Asesor de Imagen (Cloudflare Worker + D1 + R2).
// Pública: /api/cortes, /api/recomendar, /api/imagenes/:id   ·   Privada: /api/admin/* (sesión por cookie)
import { recomendar, esRecomendable, CAMPOS_LISTA } from "../../asesor/engine.js";
import { validarCorte, validarVariante, validarFuente, slugDe, ErrorValidacion } from "./validar.js";
import { verificarPassword, crearSesion, leerSesion, cookie, leerCookie } from "./auth.js";

const SEG = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Cache-Control": "no-store" };
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEG, ...extra } });
const err = (m, status = 400) => json({ error: m }, status);
const MAX_IMG = 2 * 1024 * 1024, MAX_INTENTOS = 5, VENTANA_MIN = 10;

// ---------- lectura de fichas ----------
const parse = (c) => { for (const k of CAMPOS_LISTA) c[k] = JSON.parse(c[k] || "[]"); return c; };
async function cargarCortes(env, id = null) {
  const w = id ? "WHERE id = ?1" : "", b = id ? [id] : [];
  const q = t => env.DB.prepare(`SELECT * FROM ${t} ${t === "cortes" ? w : id ? "WHERE corte_id = ?1" : ""} ORDER BY ${t === "cortes" ? "nombre" : "id"}`).bind(...b).all();
  const [cs, vs, fs, ims] = await Promise.all(["cortes", "variantes", "fuentes", "imagenes"].map(q));
  const por = (rows) => rows.results.reduce((m, r) => ((m[r.corte_id] ||= []).push(r), m), {});
  const V = por(vs), F = por(fs), I = por(ims);
  return cs.results.map(c => ({ ...parse(c), variantes: V[c.id] || [], fuentes: F[c.id] || [], imagenes: I[c.id] || [] }));
}
/** Lo que ve el público: fichas verificadas completas; el resto, solo nombre y estado. */
function vistaPublica(c) {
  if (!c.publicado) return null;
  if (!esRecomendable(c)) return { slug: c.slug, nombre: c.nombre, estado: c.estado };
  const { notas_internas, verificado_por, id, creado_en, actualizado_en, ...resto } = c;
  return { ...resto, variantes: c.variantes.map(({ id, corte_id, ...v }) => v),
    fuentes: c.fuentes.map(({ id, corte_id, ...f }) => f),
    imagenes: c.imagenes.map(i => ({ url: `/api/imagenes/${i.id}`, alt: i.alt, variante_id: i.variante_id })) };
}
const publico = async env => (await cargarCortes(env)).map(vistaPublica).filter(Boolean);

// ---------- auditoría y estado ----------
const audit = (env, accion, entidad, id, detalle = "") =>
  env.DB.prepare("INSERT INTO auditoria (accion, entidad, entidad_id, detalle) VALUES (?1,?2,?3,?4)").bind(accion, entidad, id, detalle);
/** Cambiar una ficha verificada la devuelve a revisión: lo publicado siempre es lo que alguien revisó. */
const reabrir = (env, corteId) =>
  env.DB.prepare("UPDATE cortes SET estado = CASE WHEN estado='verificado' THEN 'pendiente' ELSE estado END, actualizado_en = datetime('now') WHERE id = ?1").bind(corteId);

async function body(req) { try { const b = await req.json(); return b && typeof b === "object" ? b : {}; } catch { throw new ErrorValidacion("El cuerpo debe ser JSON"); } }

// ---------- login ----------
async function login(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "local";
  const f = await env.DB.prepare("SELECT cantidad, desde FROM intentos_login WHERE clave = ?1").bind(ip).first();
  const vigente = f && (Date.now() - Date.parse(f.desde + "Z")) < VENTANA_MIN * 60000;
  if (vigente && f.cantidad >= MAX_INTENTOS) return err("Demasiados intentos. Esperá 10 minutos.", 429);
  const { password } = await body(req);
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) return err("El gestor no está configurado", 503);
  if (!password || !(await verificarPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await env.DB.prepare(vigente
      ? "UPDATE intentos_login SET cantidad = cantidad + 1 WHERE clave = ?1"
      : "INSERT OR REPLACE INTO intentos_login (clave, cantidad, desde) VALUES (?1, 1, datetime('now'))").bind(ip).run();
    return err("Contraseña incorrecta", 401);
  }
  await env.DB.prepare("DELETE FROM intentos_login WHERE clave = ?1").bind(ip).run();
  return json({ ok: true }, 200, { "Set-Cookie": cookie(await crearSesion(env.SESSION_SECRET), req, env, 8 * 3600) });
}

// ---------- gestor ----------
async function admin(req, env, url, ruta) {
  const m = ruta.match.bind(ruta);
  if (req.method !== "GET" && req.headers.get("Origin") && req.headers.get("Origin") !== url.origin) return err("Origen no permitido", 403);
  if (req.method === "POST" && ruta === "/api/admin/login") return login(req, env);
  if (!(await leerSesion(leerCookie(req), env.SESSION_SECRET))) return err("No autorizado", 401);
  if (ruta === "/api/admin/me") return json({ ok: true, r2: !!env.IMAGENES });
  if (req.method === "POST" && ruta === "/api/admin/logout") return json({ ok: true }, 200, { "Set-Cookie": cookie("", req, env, 0) });

  if (ruta === "/api/admin/cortes") {
    if (req.method === "GET") return json(await cargarCortes(env));
    if (req.method === "POST") {
      const d = validarCorte(await body(req), { crear: true }); d.slug = slugDe(d.nombre);
      if (!d.slug) return err("Nombre inválido");
      const cols = Object.keys(d);
      try {
        const r = await env.DB.prepare(`INSERT INTO cortes (${cols.join(",")}) VALUES (${cols.map((_, i) => "?" + (i + 1)).join(",")})`).bind(...Object.values(d)).run();
        await audit(env, "crear", "corte", r.meta.last_row_id, d.nombre).run();
        return json((await cargarCortes(env, r.meta.last_row_id))[0], 201);
      } catch (e) { if (/UNIQUE/i.test(e.message)) return err("Ya existe un corte con ese nombre", 409); throw e; }
    }
  }
  let r;
  if ((r = m(/^\/api\/admin\/cortes\/(\d+)$/))) {
    const id = +r[1];
    if (req.method === "GET") { const c = (await cargarCortes(env, id))[0]; return c ? json(c) : err("No existe", 404); }
    if (req.method === "PUT") {
      const d = validarCorte(await body(req)); const cols = Object.keys(d);
      if (!(await env.DB.prepare("SELECT 1 FROM cortes WHERE id = ?1").bind(id).first())) return err("No existe", 404);
      const tocaContenido = cols.some(c => c !== "publicado" && c !== "notas_internas");
      const sets = cols.map((c, i) => `${c} = ?${i + 2}`).concat("actualizado_en = datetime('now')");
      if (tocaContenido) sets.push("estado = CASE WHEN estado='verificado' THEN 'pendiente' ELSE estado END");
      await env.DB.batch([env.DB.prepare(`UPDATE cortes SET ${sets.join(", ")} WHERE id = ?1`).bind(id, ...Object.values(d)),
        audit(env, "editar", "corte", id, cols.join(","))]);
      return json((await cargarCortes(env, id))[0]);
    }
  }
  if ((r = m(/^\/api\/admin\/cortes\/(\d+)\/estado$/)) && req.method === "POST") {
    const id = +r[1], { estado, confirmo_revision } = await body(req);
    const c = (await cargarCortes(env, id))[0];
    if (!c) return err("No existe", 404);
    if (!["borrador", "pendiente", "verificado"].includes(estado)) return err("Estado inválido");
    if (estado === "verificado") {
      const falta = [];
      if (c.estado !== "pendiente") falta.push("la ficha debe pasar primero por «pendiente de revisión»");
      if (confirmo_revision !== true) falta.push("hay que confirmar que se revisó el contenido contra las fuentes");
      if (!c.descripcion) falta.push("falta la descripción");
      if (!c.fuentes.length) falta.push("falta al menos una fuente con autor y enlace");
      for (const k of ["pelos", "largos", "estilos"]) if (!c[k].length) falta.push(`faltan datos de ${k}`);
      if (falta.length) return json({ error: "No se puede verificar todavía", faltan: falta }, 422);
    }
    const ver = estado === "verificado";
    await env.DB.batch([env.DB.prepare("UPDATE cortes SET estado=?2, verificado_por=?3, verificado_en=?4, actualizado_en=datetime('now') WHERE id=?1")
      .bind(id, estado, ver ? (env.ADMIN_NOMBRE || "admin") : null, ver ? new Date().toISOString() : null), audit(env, "estado", "corte", id, estado)]);
    return json((await cargarCortes(env, id))[0]);
  }
  // variantes y fuentes comparten forma: POST /cortes/:id/<tipo>, PUT|DELETE /<tipo>/:id
  for (const [tipo, tabla, valida] of [["variantes", "variantes", validarVariante], ["fuentes", "fuentes", validarFuente]]) {
    if ((r = m(new RegExp(`^/api/admin/cortes/(\\d+)/${tipo}$`))) && req.method === "POST") {
      const cid = +r[1]; if (!(await env.DB.prepare("SELECT 1 FROM cortes WHERE id=?1").bind(cid).first())) return err("No existe", 404);
      const d = { corte_id: cid, ...valida(await body(req)) }, cols = Object.keys(d);
      const ins = await env.DB.prepare(`INSERT INTO ${tabla} (${cols.join(",")}) VALUES (${cols.map((_, i) => "?" + (i + 1)).join(",")})`).bind(...Object.values(d)).run();
      await env.DB.batch([reabrir(env, cid), audit(env, "crear", tabla, ins.meta.last_row_id)]);
      return json((await cargarCortes(env, cid))[0], 201);
    }
    if ((r = m(new RegExp(`^/api/admin/${tipo}/(\\d+)$`)))) {
      const id = +r[1], fila = await env.DB.prepare(`SELECT corte_id FROM ${tabla} WHERE id=?1`).bind(id).first();
      if (!fila) return err("No existe", 404);
      if (req.method === "PUT") {
        const d = valida(await body(req)), cols = Object.keys(d);
        await env.DB.batch([env.DB.prepare(`UPDATE ${tabla} SET ${cols.map((c, i) => `${c}=?${i + 2}`).join(",")} WHERE id=?1`).bind(id, ...Object.values(d)),
          reabrir(env, fila.corte_id), audit(env, "editar", tabla, id)]);
        return json((await cargarCortes(env, fila.corte_id))[0]);
      }
      if (req.method === "DELETE") {
        try { await env.DB.prepare(`DELETE FROM ${tabla} WHERE id=?1`).bind(id).run(); }
        catch (e) { if (/ultima_fuente/.test(e.message)) return err("No se puede borrar la única fuente de una ficha verificada. Pasala a borrador primero.", 409); throw e; }
        await env.DB.batch([reabrir(env, fila.corte_id), audit(env, "borrar", tabla, id)]);
        return json((await cargarCortes(env, fila.corte_id))[0]);
      }
    }
  }
  // imágenes (R2)
  if ((r = m(/^\/api\/admin\/cortes\/(\d+)\/imagenes$/)) && req.method === "POST") {
    if (!env.IMAGENES) return err("R2 todavía no está configurado en este entorno", 501);
    const cid = +r[1], f = await req.formData(), file = f.get("archivo");
    if (!(await env.DB.prepare("SELECT 1 FROM cortes WHERE id=?1").bind(cid).first())) return err("No existe", 404);
    if (f.get("confirmo_sin_clientes") !== "1") return err("Confirmá que la foto no es de un cliente sin consentimiento");
    const derechos = String(f.get("derechos") || "").trim();
    if (!derechos) return err("Indicá de quién es la foto o con qué permiso se usa");
    if (!file || typeof file === "string") return err("Falta el archivo");
    if (file.size > MAX_IMG) return err("La imagen supera 2 MB", 413);
    const bytes = new Uint8Array(await file.arrayBuffer()), h = [...bytes.slice(0, 12)];
    const ext = h[0] === 0xFF && h[1] === 0xD8 ? "jpg" : h.slice(0, 4).join() === "137,80,78,71" ? "png" : (h.slice(0, 4).join() === "82,73,70,70" && h.slice(8, 12).join() === "87,69,66,80") ? "webp" : null;
    if (!ext) return err("Solo se aceptan imágenes JPG, PNG o WebP", 415);
    const key = `cortes/${cid}/${crypto.randomUUID()}.${ext}`;
    await env.IMAGENES.put(key, bytes, { httpMetadata: { contentType: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] } });
    const vid = +f.get("variante_id") || null;
    try {
      const ins = await env.DB.prepare("INSERT INTO imagenes (corte_id, variante_id, r2_key, alt, derechos) VALUES (?1,?2,?3,?4,?5)")
        .bind(cid, vid, key, String(f.get("alt") || "").slice(0, 200), derechos.slice(0, 300)).run();
      await env.DB.batch([reabrir(env, cid), audit(env, "crear", "imagen", ins.meta.last_row_id)]);
    } catch (e) { await env.IMAGENES.delete(key); throw e; }
    return json((await cargarCortes(env, cid))[0], 201);
  }
  if ((r = m(/^\/api\/admin\/imagenes\/(\d+)$/)) && req.method === "GET") { // vista previa para el gestor (incluye fichas sin verificar)
    const im = await env.DB.prepare("SELECT r2_key FROM imagenes WHERE id=?1").bind(+r[1]).first();
    const obj = im && env.IMAGENES && await env.IMAGENES.get(im.r2_key);
    return obj ? new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } }) : err("No encontrado", 404);
  }
  if ((r = m(/^\/api\/admin\/imagenes\/(\d+)$/)) && req.method === "DELETE") {
    const im = await env.DB.prepare("SELECT corte_id, r2_key FROM imagenes WHERE id=?1").bind(+r[1]).first();
    if (!im) return err("No existe", 404);
    await env.DB.batch([env.DB.prepare("DELETE FROM imagenes WHERE id=?1").bind(+r[1]), audit(env, "borrar", "imagen", +r[1])]);
    if (env.IMAGENES) await env.IMAGENES.delete(im.r2_key);
    return json((await cargarCortes(env, im.corte_id))[0]);
  }
  return err("No encontrado", 404);
}

// ---------- entrada ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url), ruta = url.pathname;
    try {
      if (ruta.startsWith("/api/admin/")) return await admin(req, env, url, ruta);
      if (req.method === "GET" && ruta === "/api/cortes") return json(await publico(env), 200, { "Cache-Control": "public, max-age=60" });
      if (req.method === "POST" && ruta === "/api/recomendar") {
        const res = recomendar(await body(req), await cargarCortes(env));
        return json({ ...res, recomendaciones: res.recomendaciones.map(x => ({ ...x, corte: vistaPublica(x.corte), variante: x.variante && { nombre: x.variante.nombre, descripcion: x.variante.descripcion } })) });
      }
      let r;
      if (req.method === "GET" && (r = ruta.match(/^\/api\/imagenes\/(\d+)$/))) {
        if (!env.IMAGENES) return err("No encontrado", 404);
        const im = await env.DB.prepare("SELECT i.r2_key FROM imagenes i JOIN cortes c ON c.id=i.corte_id WHERE i.id=?1 AND c.publicado=1 AND c.estado='verificado'").bind(+r[1]).first();
        const obj = im && await env.IMAGENES.get(im.r2_key);
        if (!obj) return err("No encontrado", 404);
        return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600" } });
      }
      return err("No encontrado", 404);
    } catch (e) {
      if (e instanceof ErrorValidacion) return err(e.message, 400);
      console.error(e); return err("Error interno", 500);
    }
  },
};
