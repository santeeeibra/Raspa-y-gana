// API de LAS VEGAS · Asesor de Imagen (Cloudflare Worker + D1 + R2).
// Pública: /api/cortes, /api/recomendar, /api/imagenes/:id   ·   Privada: /api/admin/* (sesión por cookie)
import { recomendar, esRecomendable, CAMPOS_LISTA } from "../../asesor/engine.js";
import { validarCorte, validarVariante, validarFuente, slugDe, ErrorValidacion } from "./validar.js";
import { PREGUNTAS } from "../../asesor/engine.js";
import { verificarPassword, crearSesion, leerSesion, cookie, leerCookie, csrfValido } from "./auth.js";
import { limitar, leerLimitado } from "./limites.js";
import { investigacion } from "./investigacion.js";

const SEG = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Cross-Origin-Resource-Policy": "same-site" };
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEG, ...extra } });
const err = (m, status = 400, extra = {}) => json({ error: m }, status, extra);
const MAX_IMG = 2 * 1024 * 1024, MAX_MULTIPART = MAX_IMG + 64 * 1024, MAX_JSON = 64 * 1024, MAX_FOTOS = 12;
const MAX_INTENTOS = 5, MAX_INTENTOS_GLOBAL = 30, VENTANA_MIN = 10;
const ipDe = req => req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "local";
const lista = v => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
const soloRevisor = s => s.rol === "revisor" ? null : err("Esta acción la hace una persona con rol revisor", 403);

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
/** Lo que ve el público. LISTA BLANCA: un campo nuevo en la base nunca sale al público salvo que se agregue acá. */
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]]));
const CAMPOS_PUBLICOS = ["slug", "nombre", "descripcion", "caracteristicas", "mantenimiento", "tiempo_peinado", ...CAMPOS_LISTA, "estado", "publicado", "verificado_en"];
function vistaPublica(c) {
  if (c.estado !== "verificado") return { slug: c.slug, nombre: c.nombre, estado: c.estado };   // borradores: solo nombre y estado
  if (!c.publicado) return null;                                                                 // verificada pero retirada: invisible
  return { ...pick(c, CAMPOS_PUBLICOS),
    variantes: c.variantes.map(v => pick(v, ["nombre", "descripcion", "laterales", "altura", "transicion"])),
    fuentes: c.fuentes.map(f => pick(f, ["autor", "titulo", "url", "afirmacion", "consultada_en"])),
    imagenes: c.imagenes.map(i => ({ url: `/api/imagenes/${i.id}`, alt: i.alt })) };
}
const publico = async env => (await cargarCortes(env)).map(vistaPublica).filter(Boolean);

// ---------- auditoría y estado ----------
const auditar = (env, accion, entidad, id, detalle = "") =>
  env.DB.prepare("INSERT INTO auditoria (accion, entidad, entidad_id, detalle) VALUES (?1,?2,?3,?4)").bind(accion, entidad, id, detalle);
/** Cambiar una ficha verificada la devuelve a revisión: lo publicado siempre es lo que alguien revisó. */
const reabrir = (env, corteId) => // (al perder la verificación, un trigger también la retira del público)
  env.DB.prepare("UPDATE cortes SET estado = CASE WHEN estado='verificado' THEN 'pendiente' ELSE estado END, actualizado_en = datetime('now') WHERE id = ?1").bind(corteId);

async function body(req, max = MAX_JSON) {
  if (!/^application\/json\b/i.test(req.headers.get("Content-Type") || "")) throw new ErrorValidacion("Content-Type debe ser application/json");
  const bytes = await leerLimitado(req, max);
  if (!bytes) throw new ErrorTamano(`El cuerpo supera ${Math.round(max / 1024)} KB`);
  try { const b = JSON.parse(new TextDecoder().decode(bytes)); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; }
  catch { throw new ErrorValidacion("El cuerpo debe ser JSON válido"); }
}
class ErrorTamano extends Error {}

// ---------- login ----------
async function intentosFallidos(env, clave) {
  const f = await env.DB.prepare("SELECT cantidad, desde FROM intentos_login WHERE clave = ?1").bind(clave).first();
  return { f, vigente: !!f && (Date.now() - Date.parse(f.desde + "Z")) < VENTANA_MIN * 60000 };
}
const sumarFallo = (env, clave, vigente) => env.DB.prepare(vigente
  ? "UPDATE intentos_login SET cantidad = cantidad + 1 WHERE clave = ?1"
  : "INSERT OR REPLACE INTO intentos_login (clave, cantidad, desde) VALUES (?1, 1, datetime('now'))").bind(clave).run();

async function login(req, env) {
  const ip = ipDe(req);
  const [porIp, global] = [await intentosFallidos(env, "ip:" + ip), await intentosFallidos(env, "global")];
  if ((porIp.vigente && porIp.f.cantidad >= MAX_INTENTOS) || (global.vigente && global.f.cantidad >= MAX_INTENTOS_GLOBAL))
    return err("Demasiados intentos. Esperá 10 minutos.", 429, { "Retry-After": String(VENTANA_MIN * 60) });
  const { password } = await body(req);
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) return err("El gestor no está configurado", 503);
  let rol = null;
  if (typeof password === "string" && password.length <= 200) {
    if (env.REVISOR_PASSWORD_HASH && await verificarPassword(password, env.REVISOR_PASSWORD_HASH)) rol = "revisor";
    else if (await verificarPassword(password, env.ADMIN_PASSWORD_HASH)) rol = env.REVISOR_PASSWORD_HASH ? "editor" : "revisor"; // sin 2.ª contraseña: una sola persona hace todo
  }
  if (!rol) { await sumarFallo(env, "ip:" + ip, porIp.vigente); await sumarFallo(env, "global", global.vigente); return err("Contraseña incorrecta", 401); }
  await env.DB.prepare("DELETE FROM intentos_login WHERE clave = ?1").bind("ip:" + ip).run();
  const { token, csrf } = await crearSesion(env.SESSION_SECRET, rol);
  return json({ ok: true, rol, csrf }, 200, { "Set-Cookie": cookie(token, env, 8 * 3600) });
}

// ---------- gestor ----------
async function admin(req, env, url, ruta) {
  const m = ruta.match.bind(ruta), escribe = req.method !== "GET";
  if (req.method === "OPTIONS") return err("Método no permitido", 405);                    // el gestor jamás acepta CORS
  const sfs = req.headers.get("Sec-Fetch-Site");
  if (escribe && sfs && !["same-origin", "none"].includes(sfs)) return err("Origen no permitido", 403);
  const origen = req.headers.get("Origin");
  if (escribe && origen && origen !== url.origin && !lista(env.ADMIN_ORIGINS).includes(origen)) return err("Origen no permitido", 403);
  if (!limitar("admin:" + ipDe(req), 240, 60000).ok) return err("Demasiadas solicitudes", 429, { "Retry-After": "60" });
  if (req.method === "POST" && ruta === "/api/admin/login") return login(req, env);
  const ses = await leerSesion(leerCookie(req, env), env.SESSION_SECRET);
  if (!ses) return err("No autorizado", 401);
  // CSRF: toda operación que cambia algo exige el token de la sesión, haya o no encabezado Origin.
  if (escribe && !csrfValido(req.headers.get("X-CSRF-Token"), ses.csrf)) return err("Token CSRF inválido", 403);
  if (ruta === "/api/admin/me") return json({ ok: true, rol: ses.rol, csrf: ses.csrf, r2: !!env.IMAGENES, modo_unico: !env.REVISOR_PASSWORD_HASH });
  if (req.method === "POST" && ruta === "/api/admin/logout") return json({ ok: true }, 200, { "Set-Cookie": cookie("", env, 0) });
  const quien = ses.rol, audit = (_e, accion, entidad, id, detalle = "") => auditar(env, accion, entidad, id, `[${quien}] ${detalle}`.trim());

  if (ruta.startsWith("/api/admin/investigaciones") || /^\/api\/admin\/cortes\/\d+\/versiones$/.test(ruta))
    return investigacion(req, env, { ruta, ses, json, err, body, soloRevisor });

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
      const no = soloRevisor(ses); if (no) return no;
      const falta = [];
      if (c.estado !== "pendiente") falta.push("la ficha debe pasar primero por «pendiente de revisión»");
      if (confirmo_revision !== true) falta.push("hay que confirmar que se revisó el contenido contra las fuentes");
      if (!c.descripcion) falta.push("falta la descripción");
      if (!c.fuentes.length) falta.push("falta al menos una fuente con autor y enlace");
      if (c.fuentes.some(f => !f.revisada_en)) falta.push("hay fuentes sin marcar como revisadas");
      for (const k of ["pelos", "largos", "estilos"]) if (!c[k].length) falta.push(`faltan datos de ${k}`);
      if (falta.length) return json({ error: "No se puede verificar todavía", faltan: falta }, 422);
    }
    const ver = estado === "verificado";
    await env.DB.batch([env.DB.prepare("UPDATE cortes SET estado=?2, verificado_por=?3, verificado_en=?4, actualizado_en=datetime('now') WHERE id=?1")
      .bind(id, estado, ver ? (env.ADMIN_NOMBRE || "revisor") : null, ver ? new Date().toISOString() : null), audit(env, "estado", "corte", id, estado)]);
    return json((await cargarCortes(env, id))[0]);
  }
  // publicar / retirar: paso aparte, solo para fichas ya verificadas
  if ((r = m(/^\/api\/admin\/cortes\/(\d+)\/publicar$/)) && req.method === "POST") {
    const no = soloRevisor(ses); if (no) return no;
    const id = +r[1], { publicado, confirmo } = await body(req);
    const c = (await cargarCortes(env, id))[0];
    if (!c) return err("No existe", 404);
    if (publicado) {
      if (c.estado !== "verificado") return json({ error: "Solo se puede publicar una ficha verificada" }, 422);
      if (confirmo !== true) return json({ error: "Hay que confirmar la publicación" }, 422);
    }
    await env.DB.batch([env.DB.prepare("UPDATE cortes SET publicado=?2, actualizado_en=datetime('now') WHERE id=?1").bind(id, publicado ? 1 : 0), audit(env, publicado ? "publicar" : "retirar", "corte", id)]);
    return json((await cargarCortes(env, id))[0]);
  }
  // revisar una fuente (la revisión es de la FUENTE; verificar la ficha es otro paso)
  if ((r = m(/^\/api\/admin\/fuentes\/(\d+)\/revisar$/)) && req.method === "POST") {
    const no = soloRevisor(ses); if (no) return no;
    const id = +r[1], { revisada } = await body(req);
    const f = await env.DB.prepare("SELECT corte_id FROM fuentes WHERE id=?1").bind(id).first();
    if (!f) return err("No existe", 404);
    await env.DB.batch([env.DB.prepare("UPDATE fuentes SET revisada_en=?2, revisada_por=?3 WHERE id=?1").bind(id, revisada ? new Date().toISOString() : null, revisada ? (env.ADMIN_NOMBRE || "revisor") : null),
      audit(env, revisada ? "revisar" : "desmarcar", "fuente", id)]);
    return json((await cargarCortes(env, f.corte_id))[0]);
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
        await env.DB.batch([env.DB.prepare(`UPDATE ${tabla} SET ${cols.map((c, i) => `${c}=?${i + 2}`).join(",")}${tipo === "fuentes" ? ", revisada_en=NULL, revisada_por=NULL" : ""} WHERE id=?1`).bind(id, ...Object.values(d)),
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
    const cid = +r[1];
    const decl = req.headers.get("Content-Length");
    if (decl === null) return err("Falta Content-Length", 411);
    if (+decl > MAX_MULTIPART) return err("La imagen supera 2 MB", 413);
    if (!/^multipart\/form-data\b/i.test(req.headers.get("Content-Type") || "")) return err("Debe enviarse como multipart/form-data", 415);
    if (!(await env.DB.prepare("SELECT 1 FROM cortes WHERE id=?1").bind(cid).first())) return err("No existe", 404);
    if ((await env.DB.prepare("SELECT COUNT(*) n FROM imagenes WHERE corte_id=?1").bind(cid).first()).n >= MAX_FOTOS) return err(`Máximo ${MAX_FOTOS} fotos por corte`, 409);
    const f = await req.formData(), file = f.get("archivo");
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
// Solo se aceptan respuestas conocidas del cuestionario (nada más entra al motor)
const VALIDAS = Object.fromEntries(PREGUNTAS.map(p => [p.id, new Set(p.opciones.map(o => o.v))]));
const limpiarRespuestas = b => Object.fromEntries(Object.entries(b).filter(([k, v]) => VALIDAS[k]?.has(v)));

/** CORS solo para lectura pública y solo para los sitios autorizados (PUBLIC_ORIGINS). El gestor nunca lo recibe. */
function conCors(req, env, res) {
  const o = req.headers.get("Origin");
  if (o && lista(env.PUBLIC_ORIGINS).includes(o)) { res.headers.set("Access-Control-Allow-Origin", o); res.headers.append("Vary", "Origin"); }
  return res;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), ruta = url.pathname, ip = ipDe(req);
    try {
      if (ruta.startsWith("/api/admin/")) return await admin(req, env, url, ruta);
      const publica = ruta === "/api/cortes" || ruta === "/api/recomendar";
      if (publica && req.method === "OPTIONS")
        return conCors(req, env, new Response(null, { status: 204, headers: { ...SEG, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } }));
      if (req.method === "GET" && ruta === "/api/cortes") {
        const l = limitar("cortes:" + ip, 120, 60000); if (!l.ok) return conCors(req, env, err("Demasiadas solicitudes", 429, { "Retry-After": String(l.reintentarSeg) }));
        return conCors(req, env, json(await publico(env), 200, { "Cache-Control": "public, max-age=60" }));
      }
      if (req.method === "POST" && ruta === "/api/recomendar") {
        const l = limitar("rec:" + ip, 30, 60000); if (!l.ok) return conCors(req, env, err("Demasiadas solicitudes", 429, { "Retry-After": String(l.reintentarSeg) }));
        const res = recomendar(limpiarRespuestas(await body(req)), await cargarCortes(env));
        return conCors(req, env, json({ estado: res.estado, mensaje: res.mensaje, descartados: res.descartados,
          recomendaciones: res.recomendaciones.map(x => { const c = vistaPublica(x.corte);
            return { puntaje: x.puntaje, razones: x.razones, criteriosEvaluados: x.criteriosEvaluados, datosFaltantes: x.datosFaltantes, corte: c, respaldo: c.fuentes,
              variante: x.variante && pick(x.variante, ["nombre", "descripcion", "laterales", "altura", "transicion"]) }; }) }));
      }
      let r;
      if (req.method === "GET" && (r = ruta.match(/^\/api\/imagenes\/(\d+)$/))) {
        if (!env.IMAGENES) return err("No encontrado", 404);
        const im = await env.DB.prepare("SELECT i.r2_key FROM imagenes i JOIN cortes c ON c.id=i.corte_id WHERE i.id=?1 AND c.publicado=1 AND c.estado='verificado'").bind(+r[1]).first();
        const obj = im && await env.IMAGENES.get(im.r2_key);
        if (!obj) return err("No encontrado", 404);
        return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600", "Cross-Origin-Resource-Policy": "cross-origin" } });
      }
      return err("No encontrado", 404);
    } catch (e) {
      if (e instanceof ErrorValidacion) return err(e.message, 400);
      if (e instanceof ErrorTamano) return err(e.message, 413);
      console.error(e); return err("Error interno", 500);
    }
  },
};
