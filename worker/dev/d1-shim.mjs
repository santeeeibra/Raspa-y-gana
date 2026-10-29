// Imitación mínima de D1 sobre node:sqlite, SOLO para desarrollo y pruebas locales.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  }
}
export function crearD1(archivo = ":memory:", migraciones = new URL("../migrations/", import.meta.url)) {
  const db = new DatabaseSync(archivo);
  db.exec("PRAGMA foreign_keys = ON");
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='cortes'").get())
    for (const f of readdirSync(migraciones).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, migraciones), "utf8"));
  return {
    prepare: sql => new Stmt(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
