-- Investigación asistida: la IA (o una persona) PROPONE; una persona decide. Nada se publica solo.

CREATE TABLE investigaciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id      INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','investigando','propuesta_preparada','en_revision','aprobada','rechazada')),
  consulta      TEXT NOT NULL DEFAULT '',
  demo          INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),   -- datos de demostración: jamás se aplican a una ficha
  proveedor     TEXT NOT NULL DEFAULT 'manual',                     -- manual | workers-ai+<buscador>
  error         TEXT NOT NULL DEFAULT '',                           -- último fallo de un proveedor (el trabajo no se pierde)
  creada_por    TEXT NOT NULL,
  creada_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_en TEXT NOT NULL DEFAULT (datetime('now')),
  decidida_por  TEXT,
  decidida_en   TEXT,
  nota_decision TEXT NOT NULL DEFAULT ''
);

-- Una fuente pasa por tres niveles: encontrada (apareció) -> leida (una persona o el lector guardó el texto) -> validada (un revisor la aceptó).
CREATE TABLE inv_fuentes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  investigacion_id INTEGER NOT NULL REFERENCES investigaciones(id) ON DELETE CASCADE,
  autor           TEXT NOT NULL DEFAULT '' ,
  titulo          TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL CHECK (url LIKE 'https://%'),
  nivel           TEXT NOT NULL DEFAULT 'encontrada' CHECK (nivel IN ('encontrada','leida','validada')),
  origen          TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','busqueda')),
  texto           TEXT,                       -- texto leído (máx. 200 KB). Es información NO confiable: nunca se ejecuta ni se obedece.
  leida_por       TEXT, leida_en TEXT,
  validada_por    TEXT, validada_en TEXT,
  UNIQUE (investigacion_id, url)
);

CREATE TABLE afirmaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  investigacion_id INTEGER NOT NULL REFERENCES investigaciones(id) ON DELETE CASCADE,
  campo           TEXT NOT NULL CHECK (campo IN ('descripcion','caracteristicas','mantenimiento','tiempo_peinado','pelos','largos','estilos','entradas','densidades','volumenes','laterales','alturas','transiciones')),
  valor           TEXT NOT NULL,              -- texto, o JSON si el campo es una lista
  valor_original  TEXT NOT NULL,              -- lo que se propuso al principio (para ver qué se editó)
  estado          TEXT NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','aceptada','editada','rechazada')),
  origen          TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','ia')),
  decidida_por    TEXT, decidida_en TEXT
);

-- Cada afirmación se respalda con un fragmento concreto de una fuente.
CREATE TABLE evidencias (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  afirmacion_id  INTEGER NOT NULL REFERENCES afirmaciones(id) ON DELETE CASCADE,
  fuente_id      INTEGER NOT NULL REFERENCES inv_fuentes(id) ON DELETE RESTRICT,
  fragmento      TEXT NOT NULL CHECK (length(trim(fragmento)) > 0 AND length(fragmento) <= 600),
  referencia     TEXT NOT NULL DEFAULT '',    -- sección, página, minuto…
  UNIQUE (afirmacion_id, fuente_id, fragmento)
);

-- Historial de cambios: quién, cuándo y qué.
CREATE TABLE revisiones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  investigacion_id INTEGER NOT NULL REFERENCES investigaciones(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  entidad         TEXT NOT NULL DEFAULT '',
  entidad_id      INTEGER,
  antes           TEXT NOT NULL DEFAULT '',
  despues         TEXT NOT NULL DEFAULT '',
  responsable     TEXT NOT NULL,
  rol             TEXT NOT NULL,
  creada_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Versiones de la ficha: se guarda una copia ANTES de aplicar una aprobación.
CREATE TABLE versiones_ficha (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  corte_id        INTEGER NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
  investigacion_id INTEGER REFERENCES investigaciones(id) ON DELETE SET NULL,
  version         INTEGER NOT NULL,
  contenido       TEXT NOT NULL CHECK (json_valid(contenido)),
  motivo          TEXT NOT NULL DEFAULT '',
  creada_por      TEXT NOT NULL,
  creada_en       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (corte_id, version)
);

-- Tope de uso por día (investigaciones, búsquedas, propuestas de IA): controla costos.
CREATE TABLE uso_diario (
  dia   TEXT NOT NULL,
  tipo  TEXT NOT NULL,
  n     INTEGER NOT NULL,
  PRIMARY KEY (dia, tipo)
);

CREATE INDEX idx_inv_corte ON investigaciones(corte_id);
CREATE INDEX idx_invf_inv ON inv_fuentes(investigacion_id);
CREATE INDEX idx_afirm_inv ON afirmaciones(investigacion_id);
CREATE INDEX idx_evid_afirm ON evidencias(afirmacion_id);

-- Una afirmación ACEPTADA o EDITADA necesita al menos una evidencia con fuente leída (la base lo exige).
CREATE TRIGGER afirmacion_aceptada_requiere_evidencia
BEFORE UPDATE OF estado ON afirmaciones
WHEN NEW.estado IN ('aceptada','editada') AND NOT EXISTS (
  SELECT 1 FROM evidencias e JOIN inv_fuentes f ON f.id = e.fuente_id WHERE e.afirmacion_id = NEW.id AND f.nivel IN ('leida','validada'))
BEGIN SELECT RAISE(ABORT, 'afirmacion_sin_evidencia_leida'); END;

-- La IA no puede aprobar: una investigación solo pasa a 'aprobada' si ya tiene responsable y fecha.
CREATE TRIGGER investigacion_aprobada_requiere_responsable
BEFORE UPDATE OF estado ON investigaciones
WHEN NEW.estado = 'aprobada' AND (NEW.decidida_por IS NULL OR NEW.decidida_en IS NULL OR OLD.estado <> 'en_revision')
BEGIN SELECT RAISE(ABORT, 'aprobacion_requiere_responsable'); END;

CREATE TRIGGER afirmacion_nace_como_propuesta
BEFORE INSERT ON afirmaciones
WHEN NEW.estado <> 'propuesta'
BEGIN SELECT RAISE(ABORT, 'afirmacion_nace_como_propuesta'); END;
