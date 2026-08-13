-- ══════════════════════════════════════════════════════════════════════
--  0007 — una sola fuente para las fechas
-- ══════════════════════════════════════════════════════════════════════
--
--  EL PROBLEMA
--  `calendario` tenía dos juegos de columnas para lo mismo:
--
--    fecha_inicio, fecha_fin_trabajo, fecha_entrega, fecha_jornada  → date
--    inicio,       fin_trabajo,       entrega,       jornada        → text
--
--  El CRUD del admin leía y escribía las de TEXTO. En cambio
--  API.getContexto() sirve a los portales las de tipo DATE, que estaban
--  las cinco filas a NULL. Resultado: el administrador veía las fechas de
--  cada período y el miembro tenía la pestaña de calendario en blanco.
--
--  El frontend ya usa solo las columnas tipadas (commit 4ba00b1). Esta
--  migración vuelca el contenido y retira las de texto para que no vuelva
--  a haber dos fuentes.
--
--  `periodos_evaluacion` tenía sus cuatro columnas de fecha a NULL en los
--  cuatro períodos. Se rellenan PE1–PE3 desde la fila de calendario del
--  mismo número, que coincide además en descripción:
--
--    PE1 "PRUEBA PILOTO"        ↔ calendario 1 "PERÍODO PRUEBA"
--    PE2 "VOCES JOVENES"        ↔ calendario 2 "VOCES JOVENES"
--    PE3 "SOLUCIONES GLOBALES"  ↔ calendario 3 "SOLUCIONES GLOBALES"
--
--  PE4 ("UN SOLO LATIDO") se deja como está: hay DOS filas de calendario
--  con número 4 ("V CND - CLIT" y "CAMPAMENTOS AL 100") y ninguna lleva
--  ese nombre. La correspondencia no se deduce del dato, así que la fija
--  el administrador desde el panel.
--
--  Idempotente: el volcado usa coalesce, así que repetirla no pisa nada
--  que ya se haya editado a mano, y los DROP llevan IF EXISTS.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. calendario: texto → date ───────────────────────────────────────
UPDATE calendario SET
  fecha_inicio      = COALESCE(fecha_inicio,      NULLIF(TRIM(inicio),      '')::date),
  fecha_fin_trabajo = COALESCE(fecha_fin_trabajo, NULLIF(TRIM(fin_trabajo), '')::date),
  fecha_entrega     = COALESCE(fecha_entrega,     NULLIF(TRIM(entrega),     '')::date),
  fecha_jornada     = COALESCE(fecha_jornada,     NULLIF(TRIM(jornada),     '')::date);

-- Guarda: si alguna fecha de texto no llegó a su columna tipada, aborta.
-- Sin esto, el DROP de abajo destruiría el único ejemplar del dato.
DO $$
DECLARE perdidas int;
BEGIN
  SELECT count(*) INTO perdidas
  FROM calendario
  WHERE (NULLIF(TRIM(inicio),      '') IS NOT NULL AND fecha_inicio      IS NULL)
     OR (NULLIF(TRIM(fin_trabajo), '') IS NOT NULL AND fecha_fin_trabajo IS NULL)
     OR (NULLIF(TRIM(entrega),     '') IS NOT NULL AND fecha_entrega     IS NULL)
     OR (NULLIF(TRIM(jornada),     '') IS NOT NULL AND fecha_jornada     IS NULL);
  IF perdidas > 0 THEN
    RAISE EXCEPTION 'Abortado: % filas perderian fechas al eliminar las columnas de texto', perdidas;
  END IF;
END $$;

ALTER TABLE calendario
  DROP COLUMN IF EXISTS inicio,
  DROP COLUMN IF EXISTS fin_trabajo,
  DROP COLUMN IF EXISTS entrega,
  DROP COLUMN IF EXISTS jornada;

-- ── 2. periodos_evaluacion: fechas desde el calendario (PE1–PE3) ──────
UPDATE periodos_evaluacion p SET
  fecha_inicio      = COALESCE(p.fecha_inicio,      c.fecha_inicio),
  fecha_fin_trabajo = COALESCE(p.fecha_fin_trabajo, c.fecha_fin_trabajo),
  fecha_entrega     = COALESCE(p.fecha_entrega,     c.fecha_entrega),
  fecha_jornada     = COALESCE(p.fecha_jornada,     c.fecha_jornada)
FROM calendario c
WHERE c.gestion_id = p.gestion_id
  AND c.numero     = NULLIF(regexp_replace(p.nombre, '\D', '', 'g'), '')::int
  -- PE4 tiene dos filas candidatas: se excluye a propósito.
  AND c.numero < 4;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- Las columnas de texto se pueden recrear y repoblar desde las tipadas;
-- el contenido es el mismo, solo cambia el tipo.
--
-- BEGIN;
-- ALTER TABLE calendario
--   ADD COLUMN IF NOT EXISTS inicio      text,
--   ADD COLUMN IF NOT EXISTS fin_trabajo text,
--   ADD COLUMN IF NOT EXISTS entrega     text,
--   ADD COLUMN IF NOT EXISTS jornada     text;
-- UPDATE calendario SET
--   inicio      = fecha_inicio::text,
--   fin_trabajo = fecha_fin_trabajo::text,
--   entrega     = fecha_entrega::text,
--   jornada     = fecha_jornada::text;
-- -- El volcado a periodos_evaluacion no se revierte: eran NULL antes.
-- -- UPDATE periodos_evaluacion SET fecha_inicio=NULL, fecha_fin_trabajo=NULL,
-- --        fecha_entrega=NULL, fecha_jornada=NULL WHERE gestion_id = 1;
-- COMMIT;
