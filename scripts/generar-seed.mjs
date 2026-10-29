// Lee los 16 cortes de guia.html y genera:
//   worker/migrations/0002_seed_borradores.sql  (para D1)
//   asesor/catalogo.json                        (respaldo estático del catálogo)
// Solo importa NOMBRES. El texto viejo de guia.html queda en "notas_internas"
// (sin verificar) y NO se muestra al público. No se inventa ningún dato técnico.
import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync(new URL("../guia.html", import.meta.url), "utf8");
const bloque = html.slice(html.indexOf("const CORTES = ["), html.indexOf("];", html.indexOf("const CORTES = [")));
const viejos = new Map([...bloque.matchAll(/\{n:"([^"]+)",\s*d:"([^"]*)"/g)].map(m => [m[1], m[2]]));
// La lista oficial de 16 cortes está en datos/lista_cortes.txt (guia.html tiene 15: falta Mohicano)
const lista = readFileSync(new URL("../datos/lista_cortes.txt", import.meta.url), "utf8");
const cortes = lista.split("LEYENDA")[0].split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean)
  .map(nombre => ({ nombre, heredado: viejos.get(nombre) || "(sin texto previo)" }));
if (cortes.length !== 16) throw new Error("Se esperaban 16 cortes y se encontraron " + cortes.length);
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const q = s => "'" + s.replace(/'/g, "''") + "'";
const sql = ["-- Generado por scripts/generar-seed.mjs · 16 cortes importados como BORRADOR (sin datos técnicos ni fuentes)"]
  .concat(cortes.map(c => `INSERT INTO cortes (slug, nombre, estado, publicado, notas_internas) VALUES (${q(slug(c.nombre))}, ${q(c.nombre)}, 'borrador', 1, ${q("Texto heredado de guia.html (sin verificar): " + c.heredado)});`));
writeFileSync(new URL("../worker/migrations/0002_seed_borradores.sql", import.meta.url), sql.join("\n") + "\n");
const catalogo = { fuente: "estatico", cortes: cortes.map(c => ({ slug: slug(c.nombre), nombre: c.nombre, estado: "borrador" })) };
writeFileSync(new URL("../asesor/catalogo.json", import.meta.url), JSON.stringify(catalogo, null, 1) + "\n");
console.log(cortes.length + " cortes importados como borrador");
