-- Separación de funciones: revisar una fuente -> verificar la ficha -> publicarla.
ALTER TABLE fuentes ADD COLUMN revisada_en  TEXT;   -- NULL = fuente todavía sin revisar
ALTER TABLE fuentes ADD COLUMN revisada_por TEXT;

-- No se puede verificar una ficha si alguna fuente no fue revisada.
CREATE TRIGGER cortes_verificado_requiere_fuentes_revisadas
BEFORE UPDATE OF estado ON cortes
WHEN NEW.estado = 'verificado' AND EXISTS (SELECT 1 FROM fuentes WHERE corte_id = NEW.id AND revisada_en IS NULL)
BEGIN SELECT RAISE(ABORT, 'fuentes_sin_revisar'); END;

-- Solo se puede publicar una ficha verificada.
CREATE TRIGGER cortes_publicar_requiere_verificado
BEFORE UPDATE OF publicado ON cortes
WHEN NEW.publicado = 1 AND NEW.estado <> 'verificado'
BEGIN SELECT RAISE(ABORT, 'publicar_requiere_verificado'); END;

CREATE TRIGGER cortes_insert_publicado_bloqueado
BEFORE INSERT ON cortes
WHEN NEW.publicado = 1
BEGIN SELECT RAISE(ABORT, 'publicar_requiere_verificado'); END;

-- Si una ficha deja de estar verificada, se retira sola: al volver a verificarla hay que publicarla de nuevo a propósito.
CREATE TRIGGER cortes_despublicar_al_perder_verificacion
AFTER UPDATE OF estado ON cortes
WHEN NEW.estado <> 'verificado' AND NEW.publicado = 1
BEGIN UPDATE cortes SET publicado = 0 WHERE id = NEW.id; END;
