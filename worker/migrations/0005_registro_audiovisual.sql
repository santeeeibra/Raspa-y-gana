-- Recursos audiovisuales: fotos y videos con registro de origen, licencia y derechos de publicación.
ALTER TABLE imagenes ADD COLUMN tipo          TEXT NOT NULL DEFAULT 'imagen' CHECK (tipo IN ('imagen', 'video'));
ALTER TABLE imagenes ADD COLUMN vista         TEXT CHECK (vista IS NULL OR vista IN ('principal', 'frente', 'perfil', 'tres_cuartos', 'nuca'));
ALTER TABLE imagenes ADD COLUMN origen        TEXT NOT NULL DEFAULT 'propia' CHECK (origen IN ('propia', 'generado_ia', 'tercero_con_permiso'));
ALTER TABLE imagenes ADD COLUMN herramienta   TEXT;            -- p. ej. "Google Flow (Veo)" cuando es generado con IA
ALTER TABLE imagenes ADD COLUMN licencia      TEXT;            -- texto o enlace de la licencia / permiso
ALTER TABLE imagenes ADD COLUMN uso_comercial TEXT NOT NULL DEFAULT 'confirmado' CHECK (uso_comercial IN ('confirmado', 'por_confirmar'));
ALTER TABLE imagenes ADD COLUMN publicable    INTEGER NOT NULL DEFAULT 1 CHECK (publicable IN (0, 1));
ALTER TABLE imagenes ADD COLUMN mime          TEXT;
ALTER TABLE imagenes ADD COLUMN creado_en     TEXT;

-- Nada se publica sin uso comercial confirmado.
CREATE TRIGGER imagenes_publicable_requiere_licencia_ins
BEFORE INSERT ON imagenes WHEN NEW.publicable = 1 AND NEW.uso_comercial <> 'confirmado'
BEGIN SELECT RAISE(ABORT, 'publicar_requiere_licencia'); END;
CREATE TRIGGER imagenes_publicable_requiere_licencia_upd
BEFORE UPDATE OF publicable, uso_comercial ON imagenes WHEN NEW.publicable = 1 AND NEW.uso_comercial <> 'confirmado'
BEGIN SELECT RAISE(ABORT, 'publicar_requiere_licencia'); END;
