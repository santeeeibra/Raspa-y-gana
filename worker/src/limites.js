// Limitador en memoria (por instancia del Worker): freno básico contra abuso. La defensa fuerte va en
// las reglas de limitación de Cloudflare (WAF / Rate Limiting) delante del Worker; ver docs/ASESOR.md.
const cubos = new Map();
export function limitar(clave, max, ventanaMs, ahora = Date.now()) {
  const c = cubos.get(clave);
  if (!c || ahora - c.desde >= ventanaMs) { cubos.set(clave, { desde: ahora, n: 1 }); if (cubos.size > 5000) limpiar(ahora); return { ok: true }; }
  c.n++;
  return c.n <= max ? { ok: true } : { ok: false, reintentarSeg: Math.ceil((c.desde + ventanaMs - ahora) / 1000) };
}
function limpiar(ahora) { for (const [k, c] of cubos) if (ahora - c.desde > 3600000) cubos.delete(k); }
export const _reiniciarLimites = () => cubos.clear();

/** Lee el cuerpo sin pasarse de `max` bytes (aunque el cliente mienta o no mande Content-Length). */
export async function leerLimitado(req, max) {
  const decl = req.headers.get("Content-Length");
  if (decl !== null && +decl > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader(), partes = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > max) { await reader.cancel(); return null; }
    partes.push(value);
  }
  const out = new Uint8Array(total); let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
