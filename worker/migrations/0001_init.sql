-- LAS VEGAS · Asesor de Imagen · estructura inicial (Cloudflare D1 / SQLite)
-- Las listas de compatibilidad se guardan como JSON (arrays de texto).

CREATE TABLE cortes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT NOT NULL DEFAULT '',
  caracteristicas TEXT NOT NULL DEFAULT '',
  mantenimiento   TEXT NOT NULL DEFAULT '',
  tiempo_peinado  TEXT CHECK (tiempo_peinado IN ('poco','medio','mucho')),
  pelos           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pelos)),
  largos          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(largos)),
  estilos         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(estilos)),
  entradas        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entradas)),
  densidades      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(densidades)),
  volumenes       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(volumenes)),
  laterales       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(laterales)),
  alturas         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alturas)),
  transiciones    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transiciones)),
  estado          TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','pendiente','verificado')),
  publicado       INTEGER NOT NULL DEFAULT 0 CHECK (publicado IN (0,1)),
  notas_internas  TEXT NOT NULL DEFAULT '',
  verificado_por  TEXT,
  verificado_en   TEXT,
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE variantes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id    INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  laterales   TEXT CHECK (laterales IN ('degradado','tijera')),
  altura      TEXT CHECK (altura IN ('bajo','medio','alto')),
  transicion  TEXT CHECK (transicion IN ('comprimida','equilibrada','estirada'))
);

CREATE TABLE fuentes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id     INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
  autor        TEXT NOT NULL CHECK (length(trim(autor)) > 0),
  titulo       TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL CHECK (url LIKE 'https://%'),
  afirmacion   TEXT NOT NULL DEFAULT '',   -- qué dato de la ficha respalda esta fuente
  consultada_en TEXT                        -- fecha en que se revisó (AAAA-MM-DD)
);

CREATE TABLE imagenes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id    INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
  variante_id INTEGER REFERENCES variantes(id) ON DELETE SET NULL,
  r2_key      TEXT NOT NULL UNIQUE,
  alt         TEXT NOT NULL DEFAULT '',
  orden       INTEGER NOT NULL DEFAULT 0,
  derechos    TEXT NOT NULL CHECK (length(trim(derechos)) > 0),  -- de quién es la foto / permiso
  es_cliente  INTEGER NOT NULL DEFAULT 0 CHECK (es_cliente = 0)  -- fotos de clientes: bloqueadas hasta tener consentimiento
);

CREATE TABLE auditoria (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  accion    TEXT NOT NULL,
  entidad   TEXT NOT NULL,
  entidad_id INTEGER,
  detalle   TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE intentos_login (
  clave TEXT PRIMARY KEY,
  cantidad INTEGER NOT NULL,
  desde TEXT NOT NULL
);

CREATE INDEX idx_variantes_corte ON variantes(corte_id);
CREATE INDEX idx_fuentes_corte ON fuentes(corte_id);
CREATE INDEX idx_imagenes_corte ON imagenes(corte_id, orden);

-- Una ficha NO puede quedar "verificado" sin al menos una fuente (regla aplicada también en la base).
CREATE TRIGGER cortes_verificado_requiere_fuente
BEFORE UPDATE OF estado ON cortes
WHEN NEW.estado = 'verificado' AND (SELECT COUNT(*) FROM fuentes WHERE corte_id = NEW.id) = 0
BEGIN SELECT RAISE(ABORT, 'verificado_requiere_fuente'); END;

CREATE TRIGGER cortes_insert_verificado_bloqueado
BEFORE INSERT ON cortes
WHEN NEW.estado = 'verificado'
BEGIN SELECT RAISE(ABORT, 'verificado_requiere_fuente'); END;

-- No se puede borrar la última fuente de una ficha verificada.
CREATE TRIGGER fuentes_ultima_de_verificado
BEFORE DELETE ON fuentes
WHEN (SELECT estado FROM cortes WHERE id = OLD.corte_id) = 'verificado'
 AND (SELECT COUNT(*) FROM fuentes WHERE corte_id = OLD.corte_id) <= 1
BEGIN SELECT RAISE(ABORT, 'ultima_fuente_de_ficha_verificada'); END;
