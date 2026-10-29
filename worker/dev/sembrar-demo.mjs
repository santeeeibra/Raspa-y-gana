// Datos de DEMOSTRACIÓN para probar la pantalla de investigación. Todo está inventado y marcado [DEMO];
// las URLs terminan en .invalid (no existen). La API se niega a aplicar una investigación demo a una ficha.
export async function sembrarDemo(DB) {
  if (await DB.prepare("SELECT 1 FROM investigaciones WHERE demo = 1").first()) return false;
  const c = await DB.prepare("INSERT INTO cortes (slug, nombre, notas_internas) VALUES ('demo-degradado-bajo', '[DEMO] Degradado bajo (ejemplo)', 'Corte de demostración: no es información profesional.')").run();
  const i = await DB.prepare("INSERT INTO investigaciones (corte_id, estado, consulta, demo, proveedor, creada_por) VALUES (?1,'en_revision','[DEMO] degradado bajo',1,'manual','demo')").bind(c.meta.last_row_id).run(), iid = i.meta.last_row_id;
  const fs = {};
  for (const [k, autor, titulo, nivel] of [["a", "[DEMO] Autor de ejemplo A", "[DEMO] Guía de degradados (no existe)", "validada"], ["b", "[DEMO] Autor de ejemplo B", "[DEMO] Manual de barbería (no existe)", "leida"], ["c", "[DEMO] Autor de ejemplo C", "[DEMO] Artículo sin leer (no existe)", "encontrada"]]) {
    const r = await DB.prepare("INSERT INTO inv_fuentes (investigacion_id, autor, titulo, url, nivel, origen, leida_por, leida_en, validada_por, validada_en) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")
      .bind(iid, autor, titulo, `https://ejemplo.invalid/demo-${k}`, nivel, k === "c" ? "busqueda" : "manual", nivel === "encontrada" ? null : "demo", nivel === "encontrada" ? null : "2026-01-01 10:00:00", nivel === "validada" ? "demo" : null, nivel === "validada" ? "2026-01-01 11:00:00" : null).run();
    fs[k] = r.meta.last_row_id;
  }
  const afirmar = async (campo, valor, estado, origen, evs, orig = valor) => {
    const js = v => typeof v === "string" ? v : JSON.stringify(v);
    const r = await DB.prepare("INSERT INTO afirmaciones (investigacion_id, campo, valor, valor_original, origen) VALUES (?1,?2,?3,?4,?5)").bind(iid, campo, js(valor), js(orig), origen).run();
    for (const [f, frag, ref] of evs) await DB.prepare("INSERT INTO evidencias (afirmacion_id, fuente_id, fragmento, referencia) VALUES (?1,?2,?3,?4)").bind(r.meta.last_row_id, fs[f], frag, ref).run();
    if (estado !== "propuesta") await DB.prepare("UPDATE afirmaciones SET estado = ?2, decidida_por = 'demo', decidida_en = '2026-01-02 09:00:00' WHERE id = ?1").bind(r.meta.last_row_id, estado).run();
  };
  await afirmar("descripcion", "[DEMO] Texto de ejemplo sobre un degradado bajo. No es información profesional.", "aceptada", "ia", [["a", "[DEMO] Frase inventada que respaldaría la descripción.", "sección 1"]]);
  await afirmar("alturas", ["bajo"], "aceptada", "manual", [["a", "[DEMO] Frase inventada sobre la altura del degradado.", "párrafo 3"], ["b", "[DEMO] Otra frase inventada de otra fuente.", "p. 12"]]);
  await afirmar("pelos", ["lacio"], "editada", "ia", [["b", "[DEMO] Frase inventada sobre tipos de cabello.", "cap. 2"]], ["lacio", "ondulado"]);
  await afirmar("mantenimiento", "[DEMO] Retoque de ejemplo cada X semanas.", "propuesta", "ia", [["c", "[DEMO] Frase inventada de una fuente todavía sin leer.", ""]]);
  await afirmar("estilos", ["moderno"], "rechazada", "ia", [["b", "[DEMO] Frase inventada sobre estilos.", ""]]);
  for (const [t, a, d] of [["crear", "", "[DEMO] Degradado bajo (ejemplo)"], ["fuente_agregada", "", "https://ejemplo.invalid/demo-a"], ["fuente_validada", "leida", "validada"], ["afirmacion_editada", "lacio, ondulado", "lacio"], ["estado", "propuesta_preparada", "en_revision"]])
    await DB.prepare("INSERT INTO revisiones (investigacion_id, tipo, antes, despues, responsable, rol) VALUES (?1,?2,?3,?4,'demo','revisor')").bind(iid, t, a, d).run();
  return true;
}
