// Investigación asistida: flujo, persistencia y reglas. La IA solo PROPONE; aprobar, verificar y publicar son pasos humanos aparte.
import { validarCorte, ErrorValidacion, slugDe } from "./validar.js";
import { CAMPOS, CAMPOS_TEXTO, MAX_DOC_BYTES, MAX_DOCS_POR_PROPUESTA, ErrorProveedor, crearProveedores, capacidades, leerDocumento, filtrarPropuestas } from "./proveedores.js";
import { CAMPOS_LISTA } from "../../asesor/engine.js";

const EDITABLES = ["pendiente", "investigando", "propuesta_preparada"];
const DECIDIBLES = [...EDITABLES, "en_revision"];
const MAX_PEGADO = MAX_DOC_BYTES;
const norm = s => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const limite = (env, k, def) => { const n = parseInt(env[k], 10); return Number.isFinite(n) && n >= 0 ? n : def; };
const hoy = () => new Date().toISOString().slice(0, 10);
const LIM = env => ({ investigaciones: limite(env, "LIMITE_INVESTIGACIONES_DIARIAS", 10), busquedas: limite(env, "LIMITE_BUSQUEDAS_DIARIAS", 5), propuestas: limite(env, "LIMITE_PROPUESTAS_DIARIAS", 5) });

/** Cuenta un uso del día de forma atómica. Devuelve false si ya se llegó al tope. */
async function gastar(env, tipo) {
  const tope = LIM(env)[tipo];
  const r = await env.DB.prepare("INSERT INTO uso_diario (dia, tipo, n) VALUES (?1, ?2, 1) ON CONFLICT (dia, tipo) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n").bind(hoy(), tipo, tope).first();
  return !!r && tope > 0;
}
async function usoHoy(env) { const f = await env.DB.prepare("SELECT tipo, n FROM uso_diario WHERE dia = ?1").bind(hoy()).all(); return Object.fromEntries(f.results.map(r => [r.tipo, r.n])); }

// ---------- lectura ----------
async function cargar(env, id) {
  const inv = await env.DB.prepare("SELECT i.*, c.nombre AS corte_nombre, c.estado AS corte_estado FROM investigaciones i JOIN cortes c ON c.id = i.corte_id WHERE i.id = ?1").bind(id).first();
  if (!inv) return null;
  const q = (sql) => env.DB.prepare(sql).bind(id).all();
  const [fs, as, es, rs] = await Promise.all([
    q("SELECT id, investigacion_id, autor, titulo, url, nivel, origen, leida_por, leida_en, validada_por, validada_en, COALESCE(length(texto),0) AS texto_len FROM inv_fuentes WHERE investigacion_id = ?1 ORDER BY id"),
    q("SELECT * FROM afirmaciones WHERE investigacion_id = ?1 ORDER BY id"),
    q("SELECT e.* FROM evidencias e JOIN afirmaciones a ON a.id = e.afirmacion_id WHERE a.investigacion_id = ?1 ORDER BY e.id"),
    q("SELECT * FROM revisiones WHERE investigacion_id = ?1 ORDER BY id DESC LIMIT 200")]);
  const porA = es.results.reduce((m, e) => ((m[e.afirmacion_id] ||= []).push(e), m), {});
  return { ...inv, fuentes: fs.results, afirmaciones: as.results.map(a => ({ ...a, lista: CAMPOS_LISTA.includes(a.campo), valor: CAMPOS_LISTA.includes(a.campo) ? JSON.parse(a.valor) : a.valor, valor_original: CAMPOS_LISTA.includes(a.campo) ? JSON.parse(a.valor_original) : a.valor_original, evidencias: porA[a.id] || [] })), historial: rs.results };
}

export async function investigacion(req, env, c) {
  const { ruta, ses, json, err, body, soloRevisor } = c, m = ruta.match.bind(ruta);
  const resp = env.ADMIN_NOMBRE || ses.rol, rol = ses.rol, escribe = req.method !== "GET";
  const rev = (invId, tipo, entidad = "", id = null, antes = "", despues = "") =>
    env.DB.prepare("INSERT INTO revisiones (investigacion_id, tipo, entidad, entidad_id, antes, despues, responsable, rol) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(invId, tipo, entidad, id, String(antes).slice(0, 2000), String(despues).slice(0, 2000), resp, rol);
  const toca = invId => env.DB.prepare("UPDATE investigaciones SET actualizada_en = datetime('now') WHERE id = ?1").bind(invId);
  const devolver = async (invId, status = 200) => json(await cargar(env, invId), status);
  const simple = async (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  let r;

  if (ruta === "/api/admin/investigaciones/capacidades" && !escribe) return json({ ...capacidades(env), limites: LIM(env), uso_hoy: await usoHoy(env), max_documento_kb: MAX_DOC_BYTES / 1024 });

  if (ruta === "/api/admin/investigaciones") {
    if (!escribe) {
      const f = await env.DB.prepare(`SELECT i.id, i.corte_id, i.estado, i.consulta, i.demo, i.proveedor, i.actualizada_en, c.nombre AS corte_nombre,
        (SELECT COUNT(*) FROM inv_fuentes WHERE investigacion_id = i.id) AS n_fuentes, (SELECT COUNT(*) FROM afirmaciones WHERE investigacion_id = i.id) AS n_afirmaciones
        FROM investigaciones i JOIN cortes c ON c.id = i.corte_id ORDER BY i.actualizada_en DESC, i.id DESC`).all();
      return json(f.results);
    }
    if (req.method === "POST") {
      const b = await body(req); let corteId = +b.corte_id || null;
      if (!corteId) {                                          // crear un borrador nuevo desde el nombre
        const nombre = String(b.nombre || "").trim(); if (!nombre || nombre.length > 80) return err("Escribí el nombre del corte (hasta 80 caracteres)");
        const slug = slugDe(nombre); if (!slug) return err("Nombre inválido");
        if (await simple("SELECT 1 FROM cortes WHERE slug = ?1", slug)) return err("Ya existe un corte con ese nombre: elegilo de la biblioteca", 409);
        if (!(await gastar(env, "investigaciones"))) return err("Se alcanzó el límite diario de investigaciones", 429);
        const ins = await env.DB.prepare("INSERT INTO cortes (slug, nombre) VALUES (?1, ?2)").bind(slug, nombre).run(); corteId = ins.meta.last_row_id;
      } else {
        if (!(await simple("SELECT 1 FROM cortes WHERE id = ?1", corteId))) return err("No existe ese corte", 404);
        if (await simple("SELECT 1 FROM investigaciones WHERE corte_id = ?1 AND estado IN ('pendiente','investigando','propuesta_preparada','en_revision')", corteId)) return err("Ese corte ya tiene una investigación abierta", 409);
        if (!(await gastar(env, "investigaciones"))) return err("Se alcanzó el límite diario de investigaciones", 429);
      }
      const nombre = (await simple("SELECT nombre FROM cortes WHERE id = ?1", corteId)).nombre, consulta = String(b.consulta || `${nombre} corte de cabello técnica barbería`).trim().slice(0, 200);
      const p = crearProveedores(env), prov = p.buscador && p.redactor ? `workers-ai+${p.buscador.nombre}` : "manual";
      const ins = await env.DB.prepare("INSERT INTO investigaciones (corte_id, consulta, proveedor, creada_por) VALUES (?1,?2,?3,?4)").bind(corteId, consulta, prov, resp).run();
      await rev(ins.meta.last_row_id, "crear", "investigacion", ins.meta.last_row_id, "", nombre).run();
      return devolver(ins.meta.last_row_id, 201);
    }
  }
  if ((r = m(/^\/api\/admin\/cortes\/(\d+)\/versiones$/)) && !escribe) {
    const f = await env.DB.prepare("SELECT id, version, motivo, creada_por, creada_en, investigacion_id FROM versiones_ficha WHERE corte_id = ?1 ORDER BY version DESC").bind(+r[1]).all(); return json(f.results);
  }

  // ---- todo lo demás se refiere a una investigación concreta ----
  let invId = null, inv = null;
  const ubicar = async (sql, id) => { const f = await simple(sql, id); return f ? f.investigacion_id : null; };
  if ((r = m(/^\/api\/admin\/investigaciones\/(\d+)(\/.*)?$/))) invId = +r[1];
  else if ((r = m(/^\/api\/admin\/investigaciones\/fuentes\/(\d+)(\/\w+)?$/))) invId = await ubicar("SELECT investigacion_id FROM inv_fuentes WHERE id = ?1", +r[1]);
  else if ((r = m(/^\/api\/admin\/investigaciones\/afirmaciones\/(\d+)(\/\w+)?$/))) invId = await ubicar("SELECT investigacion_id FROM afirmaciones WHERE id = ?1", +r[1]);
  else if ((r = m(/^\/api\/admin\/investigaciones\/evidencias\/(\d+)$/))) invId = await ubicar("SELECT a.investigacion_id FROM evidencias e JOIN afirmaciones a ON a.id = e.afirmacion_id WHERE e.id = ?1", +r[1]);
  else return err("No encontrado", 404);
  if (!invId || !(inv = await cargar(env, invId))) return err("No existe", 404);
  const editable = EDITABLES.includes(inv.estado), decidible = DECIDIBLES.includes(inv.estado);
  const cerrada = () => err(`La investigación está ${inv.estado === "aprobada" ? "aprobada" : inv.estado === "rechazada" ? "rechazada" : "en revisión"}: no se pueden cargar ni borrar datos`, 409);

  if ((r = m(/^\/api\/admin\/investigaciones\/(\d+)$/)) && !escribe) return json(inv);

  // ---- estado ----
  if (m(/^\/api\/admin\/investigaciones\/\d+\/estado$/) && req.method === "POST") {
    const { estado, nota } = await body(req), de = inv.estado;
    const vivas = inv.afirmaciones.filter(a => a.estado !== "rechazada");
    const ok = { pendiente: ["investigando"], investigando: ["propuesta_preparada"], propuesta_preparada: ["investigando", "en_revision", "rechazada"], en_revision: ["propuesta_preparada", "rechazada"] }[de] || [];
    if (!ok.includes(estado)) return err(`No se puede pasar de «${de}» a «${estado}»`, 409);
    if (["propuesta_preparada", "en_revision"].includes(estado) && !vivas.length) return err("Falta al menos una afirmación", 422);
    if (["propuesta_preparada", "en_revision"].includes(estado)) { const sin = vivas.filter(a => !a.evidencias.length); if (sin.length) return json({ error: "Hay afirmaciones sin fuente", faltan: sin.map(a => `«${a.campo}» no tiene evidencia`) }, 422); }
    if (estado === "rechazada") { const no = soloRevisor(ses); if (no) return no; if (!String(nota || "").trim()) return err("Contá brevemente por qué se rechaza", 422); }
    const sets = estado === "rechazada" ? ", decidida_por = ?4, decidida_en = datetime('now'), nota_decision = ?5" : "";
    await env.DB.batch([env.DB.prepare(`UPDATE investigaciones SET estado = ?2, actualizada_en = datetime('now')${sets} WHERE id = ?1`).bind(...(sets ? [invId, estado, 0, resp, String(nota).slice(0, 500)] : [invId, estado])), rev(invId, "estado", "investigacion", invId, de, estado)]);
    return devolver(invId);
  }

  // ---- fuentes ----
  if (m(/^\/api\/admin\/investigaciones\/\d+\/fuentes$/) && req.method === "POST") {
    if (!editable) return cerrada();
    const b = await body(req); let u; try { u = new URL(String(b.url || "").trim()); } catch { return err("El enlace no es válido"); }
    if (u.protocol !== "https:") return err("El enlace debe empezar con https://");
    const autor = String(b.autor || "").trim().slice(0, 120), titulo = String(b.titulo || "").trim().slice(0, 200);
    if (!autor) return err("Indicá el autor (persona u organización)");
    try { const ins = await env.DB.prepare("INSERT INTO inv_fuentes (investigacion_id, autor, titulo, url, origen) VALUES (?1,?2,?3,?4,'manual')").bind(invId, autor, titulo, u.href).run();
      await env.DB.batch([rev(invId, "fuente_agregada", "fuente", ins.meta.last_row_id, "", u.href), toca(invId)]); }
    catch (e) { if (/UNIQUE/i.test(e.message)) return err("Esa fuente ya está cargada", 409); throw e; }
    return devolver(invId, 201);
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/fuentes\/(\d+)$/)) && req.method === "DELETE") {
    if (!editable) return cerrada();
    if (await simple("SELECT 1 FROM evidencias WHERE fuente_id = ?1", +r[1])) return err("Esta fuente respalda afirmaciones: quitá primero esas evidencias", 409);
    await env.DB.batch([env.DB.prepare("DELETE FROM inv_fuentes WHERE id = ?1").bind(+r[1]), rev(invId, "fuente_borrada", "fuente", +r[1]), toca(invId)]);
    return devolver(invId);
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/fuentes\/(\d+)\/leida$/)) && req.method === "POST") {
    if (!editable) return cerrada();
    const b = await body(req, MAX_PEGADO + 4096);
    if (b.confirmo_lectura !== true) return err("Confirmá que leíste el documento");
    const texto = b.texto == null ? null : String(b.texto);
    if (texto !== null && new TextEncoder().encode(texto).length > MAX_PEGADO) return err(`El texto supera ${MAX_PEGADO / 1024} KB`, 413);
    await env.DB.batch([env.DB.prepare("UPDATE inv_fuentes SET nivel = CASE WHEN nivel = 'validada' THEN nivel ELSE 'leida' END, leida_por = ?2, leida_en = datetime('now'), texto = COALESCE(?3, texto) WHERE id = ?1").bind(+r[1], resp, texto && texto.trim() ? texto : null),
      rev(invId, "fuente_leida", "fuente", +r[1], "", texto ? "con texto pegado" : "declarada leída"), toca(invId)]);
    return devolver(invId);
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/fuentes\/(\d+)\/validar$/)) && req.method === "POST") {
    const no = soloRevisor(ses); if (no) return no; if (!decidible) return cerrada();
    const { validada } = await body(req), f = inv.fuentes.find(x => x.id === +r[1]);
    if (validada && f.nivel === "encontrada") return err("Primero hay que leer la fuente", 422);
    await env.DB.batch([env.DB.prepare("UPDATE inv_fuentes SET nivel = ?2, validada_por = ?3, validada_en = ?4 WHERE id = ?1").bind(+r[1], validada ? "validada" : "leida", validada ? resp : null, validada ? new Date().toISOString() : null),
      rev(invId, validada ? "fuente_validada" : "validacion_quitada", "fuente", +r[1], f.nivel, validada ? "validada" : "leida"), toca(invId)]);
    return devolver(invId);
  }

  // ---- afirmaciones y evidencias ----
  const valorDe = (campo, valor) => {
    if (!CAMPOS.includes(campo)) throw new ErrorValidacion("Campo no permitido");
    if (campo === "tiempo_peinado" && !valor) throw new ErrorValidacion("Elegí un tiempo de peinado");
    if (CAMPOS_TEXTO.includes(campo) && !String(valor || "").trim()) throw new ErrorValidacion("El texto no puede quedar vacío");
    if (CAMPOS_LISTA.includes(campo) && (!Array.isArray(valor) || !valor.length)) throw new ErrorValidacion("Elegí al menos una opción");
    return validarCorte({ [campo]: valor })[campo];       // misma validación que la ficha
  };
  const evidenciaOk = (fuente, fragmento) => {
    const fr = String(fragmento || "").trim();
    if (fr.length < 8 || fr.length > 600) throw new ErrorValidacion("El fragmento debe tener entre 8 y 600 caracteres");
    if (fuente.texto_len > 0) return fr;   // el texto se verifica abajo (necesita el texto completo)
    return fr;
  };
  const fragmentoEnTexto = async (fuenteId, fr) => { const f = await simple("SELECT texto FROM inv_fuentes WHERE id = ?1", fuenteId); return !f?.texto || norm(f.texto).includes(norm(fr)); };
  const prepararEvidencia = async (e, afirmId) => {
    const fte = inv.fuentes.find(x => x.id === +e.fuente_id); if (!fte) throw new ErrorValidacion("La fuente no pertenece a esta investigación");
    const fr = evidenciaOk(fte, e.fragmento);
    if (!(await fragmentoEnTexto(fte.id, fr))) throw new ErrorValidacion("Ese fragmento no aparece en el texto guardado de la fuente");
    return env.DB.prepare("INSERT INTO evidencias (afirmacion_id, fuente_id, fragmento, referencia) VALUES (?1,?2,?3,?4)").bind(afirmId, fte.id, fr, String(e.referencia || "").trim().slice(0, 200));
  };
  if (m(/^\/api\/admin\/investigaciones\/\d+\/afirmaciones$/) && req.method === "POST") {
    if (!editable) return cerrada();
    const b = await body(req), v = valorDe(b.campo, b.valor);
    const evs = Array.isArray(b.evidencias) ? b.evidencias.slice(0, 5) : [];
    const ins = await env.DB.prepare("INSERT INTO afirmaciones (investigacion_id, campo, valor, valor_original, origen) VALUES (?1,?2,?3,?3,'manual')").bind(invId, b.campo, v).run(), aid = ins.meta.last_row_id;
    try { const sts = []; for (const e of evs) sts.push(await prepararEvidencia(e, aid)); await env.DB.batch([...sts, rev(invId, "afirmacion_agregada", "afirmacion", aid, "", `${b.campo}: ${v}`), toca(invId)]); }
    catch (e) { await env.DB.prepare("DELETE FROM afirmaciones WHERE id = ?1").bind(aid).run(); throw e; }
    return devolver(invId, 201);
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/afirmaciones\/(\d+)$/))) {
    const a = inv.afirmaciones.find(x => x.id === +r[1]);
    if (req.method === "PUT") {
      if (!decidible) return cerrada();
      const b = await body(req), sets = [], vals = [+r[1]]; let tipo = "afirmacion_decidida", despues = "", estadoNuevo = b.estado ?? null;
      if (estadoNuevo !== null && !["propuesta", "aceptada", "rechazada"].includes(estadoNuevo)) return err("Estado inválido");
      if ("valor" in b) {
        const nuevo = valorDe(a.campo, b.valor);
        if (nuevo !== (a.lista ? JSON.stringify(a.valor) : a.valor)) { sets.push(`valor = ?${vals.push(nuevo)}`); tipo = "afirmacion_editada"; despues = nuevo; if (estadoNuevo !== "rechazada") estadoNuevo = "editada"; }
      }
      if (estadoNuevo) { sets.push(`estado = ?${vals.push(estadoNuevo)}`); despues ||= estadoNuevo; }
      if (!sets.length) return err("No hay nada que cambiar");
      sets.push(`decidida_por = ?${vals.push(resp)}`, "decidida_en = datetime('now')");
      try { await env.DB.batch([env.DB.prepare(`UPDATE afirmaciones SET ${sets.join(", ")} WHERE id = ?1`).bind(...vals), rev(invId, tipo, "afirmacion", +r[1], a.lista ? JSON.stringify(a.valor) : a.valor, despues), toca(invId)]); }
      catch (e) { if (/afirmacion_sin_evidencia_leida/.test(e.message)) return err("Para aceptar o editar hace falta al menos una evidencia de una fuente leída", 422); throw e; }
      return devolver(invId);
    }
    if (req.method === "DELETE") {
      if (!editable) return cerrada();
      await env.DB.batch([env.DB.prepare("DELETE FROM afirmaciones WHERE id = ?1").bind(+r[1]), rev(invId, "afirmacion_borrada", "afirmacion", +r[1], a.valor), toca(invId)]); return devolver(invId);
    }
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/afirmaciones\/(\d+)\/evidencias$/)) && req.method === "POST") {
    if (!editable) return cerrada();
    const st = await prepararEvidencia(await body(req), +r[1]);
    try { await env.DB.batch([st, rev(invId, "evidencia_agregada", "afirmacion", +r[1]), toca(invId)]); } catch (e) { if (/UNIQUE/i.test(e.message)) return err("Esa evidencia ya está cargada", 409); throw e; }
    return devolver(invId, 201);
  }
  if ((r = m(/^\/api\/admin\/investigaciones\/evidencias\/(\d+)$/)) && req.method === "DELETE") {
    if (!editable) return cerrada();
    const ev = inv.afirmaciones.flatMap(a => a.evidencias.map(e => ({ ...e, a }))).find(e => e.id === +r[1]);
    if (["aceptada", "editada"].includes(ev.a.estado) && ev.a.evidencias.length === 1) return err("Es la única evidencia de una afirmación aceptada: rechazala o agregá otra evidencia primero", 409);
    await env.DB.batch([env.DB.prepare("DELETE FROM evidencias WHERE id = ?1").bind(+r[1]), rev(invId, "evidencia_borrada", "afirmacion", ev.afirmacion_id), toca(invId)]); return devolver(invId);
  }

  // ---- investigación automática (solo si hay proveedores configurados) ----
  const noDisponible = () => json({ error: "Investigación automática no disponible", disponible: false }, 503);
  const falloProveedor = async (e) => { const msg = e instanceof ErrorProveedor ? e.message : "Falló el proveedor"; await env.DB.batch([env.DB.prepare("UPDATE investigaciones SET error = ?2, actualizada_en = datetime('now') WHERE id = ?1").bind(invId, msg), rev(invId, "proveedor_fallo", "", null, "", msg)]);
    return json({ error: msg + ". Tu trabajo quedó guardado: podés seguir manualmente.", conservado: true }, 502); };
  if (m(/^\/api\/admin\/investigaciones\/\d+\/buscar$/) && req.method === "POST") {
    const { buscador } = crearProveedores(env); if (!buscador) return noDisponible();
    if (!editable) return cerrada();
    if (!(await gastar(env, "busquedas"))) return err("Se alcanzó el límite diario de búsquedas", 429);
    let res; try { res = await buscador.buscar(inv.consulta, { max: 8 }); } catch (e) { return falloProveedor(e); }
    const nuevas = []; for (const x of res) if (!inv.fuentes.some(f => f.url === x.url)) nuevas.push(env.DB.prepare("INSERT OR IGNORE INTO inv_fuentes (investigacion_id, autor, titulo, url, origen) VALUES (?1,?2,?3,?4,'busqueda')").bind(invId, String(x.autor || "").slice(0, 120), String(x.titulo || "").slice(0, 200), x.url));
    await env.DB.batch([...nuevas, env.DB.prepare("UPDATE investigaciones SET estado = CASE WHEN estado = 'pendiente' THEN 'investigando' ELSE estado END, error = '', actualizada_en = datetime('now') WHERE id = ?1").bind(invId), rev(invId, "busqueda", "", null, inv.consulta, `${nuevas.length} fuentes encontradas`)]);
    return devolver(invId);
  }
  if (m(/^\/api\/admin\/investigaciones\/\d+\/proponer$/) && req.method === "POST") {
    const { redactor } = crearProveedores(env); if (!redactor) return noDisponible();
    if (!editable) return cerrada();
    const b = await body(req), ids = [...new Set((b.fuente_ids || []).map(Number))].slice(0, MAX_DOCS_POR_PROPUESTA);
    const elegidas = inv.fuentes.filter(f => ids.includes(f.id)); if (!elegidas.length) return err(`Elegí entre 1 y ${MAX_DOCS_POR_PROPUESTA} fuentes`);
    if (!(await gastar(env, "propuestas"))) return err("Se alcanzó el límite diario de propuestas de IA", 429);
    const docs = [];
    try {
      for (const f of elegidas) {
        let texto = (await simple("SELECT texto FROM inv_fuentes WHERE id = ?1", f.id)).texto;
        if (!texto) { const d = await leerDocumento(f.url, env.fetcher || fetch); texto = d.texto;
          await env.DB.prepare("UPDATE inv_fuentes SET texto = ?2, nivel = CASE WHEN nivel = 'validada' THEN nivel ELSE 'leida' END, leida_por = 'lector-automatico', leida_en = datetime('now') WHERE id = ?1").bind(f.id, texto).run(); }
        docs.push({ url: f.url, texto });
      }
    } catch (e) { return falloProveedor(e); }
    let crudas; try { crudas = await redactor.proponer({ corte: { nombre: inv.corte_nombre }, documentos: docs }); } catch (e) { return falloProveedor(e); }
    const { ok, descartadas } = filtrarPropuestas(crudas, docs), porUrl = new Map(inv.fuentes.map(f => [f.url, f.id])); let n = 0;
    for (const p of ok) {
      let v; try { v = valorDe(p.campo, p.valor); } catch { continue; }
      const ins = await env.DB.prepare("INSERT INTO afirmaciones (investigacion_id, campo, valor, valor_original, origen) VALUES (?1,?2,?3,?3,'ia')").bind(invId, p.campo, v).run(); n++;
      for (const e of p.evidencias) await env.DB.prepare("INSERT OR IGNORE INTO evidencias (afirmacion_id, fuente_id, fragmento, referencia) VALUES (?1,?2,?3,?4)").bind(ins.meta.last_row_id, porUrl.get(e.url), e.fragmento, e.referencia).run();
    }
    await env.DB.batch([env.DB.prepare("UPDATE investigaciones SET estado = CASE WHEN estado = 'pendiente' THEN 'investigando' ELSE estado END, error = '', actualizada_en = datetime('now') WHERE id = ?1").bind(invId), rev(invId, "propuesta_ia", "", null, "", `${n} afirmaciones propuestas, ${descartadas.length} descartadas por no tener cita literal`)]);
    return json({ ...(await cargar(env, invId)), resumen_ia: { propuestas: n, descartadas: descartadas.length } });
  }

  // ---- aprobar: aplica a la ficha lo que una persona aceptó. NO verifica ni publica. ----
  if (m(/^\/api\/admin\/investigaciones\/\d+\/aprobar$/) && req.method === "POST") {
    const no = soloRevisor(ses); if (no) return no;
    const { confirmo } = await body(req);
    if (inv.demo) return err("Es una investigación de DEMOSTRACIÓN: no se puede aplicar a una ficha real", 409);
    if (inv.estado !== "en_revision") return err("Solo se aprueba una investigación que está en revisión", 409);
    if (confirmo !== true) return err("Hay que confirmar la aprobación", 422);
    const falta = [], activas = inv.afirmaciones.filter(a => ["aceptada", "editada"].includes(a.estado));
    if (inv.afirmaciones.some(a => a.estado === "propuesta")) falta.push("Quedan afirmaciones sin decidir (aceptar, editar o rechazar)");
    if (!activas.length) falta.push("No hay ninguna afirmación aceptada");
    const validada = id => inv.fuentes.find(f => f.id === id)?.nivel === "validada";
    for (const a of activas) if (!a.evidencias.some(e => validada(e.fuente_id))) falta.push(`«${a.campo}» no tiene evidencia de una fuente VALIDADA`);
    const unicos = {}; for (const a of activas) if (!a.lista) { if (unicos[a.campo]) falta.push(`Hay dos afirmaciones aceptadas para «${a.campo}»: dejá una`); unicos[a.campo] = a; }
    if (falta.length) return json({ error: "No se puede aprobar todavía", faltan: falta }, 422);

    const corte = await simple("SELECT * FROM cortes WHERE id = ?1", inv.corte_id), vers = ((await simple("SELECT COALESCE(MAX(version),0) AS v FROM versiones_ficha WHERE corte_id = ?1", corte.id)).v) + 1;
    const fuentesFicha = (await env.DB.prepare("SELECT * FROM fuentes WHERE corte_id = ?1").bind(corte.id).all()).results;
    const snap = { ...corte, fuentes: fuentesFicha };
    const cambios = {}; for (const a of activas) cambios[a.campo] = a.lista ? [...new Set([...(cambios[a.campo] || JSON.parse(corte[a.campo] || "[]")), ...a.valor])] : a.valor;
    const cols = Object.keys(cambios), vals = cols.map(k => CAMPOS_LISTA.includes(k) ? JSON.stringify(cambios[k]) : cambios[k]);
    const stmts = [env.DB.prepare("INSERT INTO versiones_ficha (corte_id, investigacion_id, version, contenido, motivo, creada_por) VALUES (?1,?2,?3,?4,?5,?6)").bind(corte.id, invId, vers, JSON.stringify(snap), "Antes de aplicar la investigación #" + invId, resp),
      env.DB.prepare(`UPDATE cortes SET ${[...cols.map((k, i) => `${k} = ?${i + 2}`), "estado = 'pendiente'", "actualizado_en = datetime('now')"].join(", ")} WHERE id = ?1`).bind(corte.id, ...vals)];
    const usadas = new Set(activas.flatMap(a => a.evidencias.map(e => e.fuente_id)).filter(validada));
    for (const f of inv.fuentes.filter(f => usadas.has(f.id) && !fuentesFicha.some(x => x.url === f.url)))
      stmts.push(env.DB.prepare("INSERT INTO fuentes (corte_id, autor, titulo, url, afirmacion, consultada_en, revisada_en, revisada_por) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(corte.id, f.autor || "Sin autor indicado", f.titulo, f.url,
        activas.filter(a => a.evidencias.some(e => e.fuente_id === f.id)).map(a => a.campo).join(", ").slice(0, 400), (f.leida_en || "").slice(0, 10) || null, f.validada_en, f.validada_por));
    stmts.push(env.DB.prepare("UPDATE investigaciones SET estado = 'aprobada', decidida_por = ?2, decidida_en = datetime('now'), actualizada_en = datetime('now') WHERE id = ?1").bind(invId, resp),
      rev(invId, "aprobada", "investigacion", invId, "", `Aplicada a la ficha (versión previa ${vers}). Falta verificar y publicar.`));
    await env.DB.batch(stmts);
    return devolver(invId);
  }
  return err("No encontrado", 404);
}
