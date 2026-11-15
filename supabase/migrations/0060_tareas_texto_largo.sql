-- ══════════════════════════════════════════════════════════════════════
--  0060 — Tareas: más espacio para el texto (documentación completa en la descripción)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  La descripción de una tarea topaba en 2 000 caracteres en la pantalla (y en 4 000 en la base): imposible pegar la documentación de
--  una página entera en «Qué se espera».
--
--  QUÉ HACE
--  · `tareas.descripcion`, `tareas_equipo.descripcion` y `tareas_equipo.instrucciones`: de 4 000 a 20 000 caracteres.
--  · `tareas_equipo.criterios_evaluacion`: de 2 000 a 5 000.
--  Es solo un tope: no toca datos, permisos ni triggers. Las restricciones se localizan por su definición (no por el nombre
--  autogenerado, que puede variar) y se reemplazan por otra con nombre fijo. Idempotente.
--
--  QUÉ NO CAMBIA
--  Títulos (160), notas de entrega/revisión (2 000), enlaces (2 000), motivos (500) y la descripción de equipos (1 000).
--
--  Reversa al final (solo si ninguna fila supera el tope anterior).
-- ══════════════════════════════════════════════════════════════════════

DO $m60$
DECLARE
  r RECORD;
  v_col RECORD;
BEGIN
  FOR v_col IN
    SELECT * FROM (VALUES
      ('tareas',        'descripcion',          20000),
      ('tareas_equipo', 'descripcion',          20000),
      ('tareas_equipo', 'instrucciones',        20000),
      ('tareas_equipo', 'criterios_evaluacion',  5000)
    ) AS t(tabla, columna, tope)
  LOOP
    IF to_regclass('public.' || v_col.tabla) IS NULL THEN CONTINUE; END IF;
    -- Quita los CHECK que limitan SOLO esta columna con char_length (los demás se dejan como están).
    FOR r IN
      SELECT c.conname FROM pg_constraint c
       WHERE c.conrelid = ('public.' || v_col.tabla)::regclass AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) ~ ('char_length\(\(?' || v_col.columna || '\)?(::text)?\) <= \d+')
         AND pg_get_constraintdef(c.oid) !~ 'AND|OR'
         AND c.conname <> v_col.tabla || '_' || v_col.columna || '_max'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_col.tabla, r.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_col.tabla, v_col.tabla || '_' || v_col.columna || '_max');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (char_length(%I) <= %s)',
                   v_col.tabla, v_col.tabla || '_' || v_col.columna || '_max', v_col.columna, v_col.tope);
  END LOOP;
END $m60$;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- (solo si no hay filas más largas que el tope anterior)
-- ALTER TABLE public.tareas DROP CONSTRAINT tareas_descripcion_max;
-- ALTER TABLE public.tareas ADD CONSTRAINT tareas_descripcion_check CHECK (char_length(descripcion) <= 4000);
-- ALTER TABLE public.tareas_equipo DROP CONSTRAINT tareas_equipo_descripcion_max, DROP CONSTRAINT tareas_equipo_instrucciones_max, DROP CONSTRAINT tareas_equipo_criterios_evaluacion_max;
-- ALTER TABLE public.tareas_equipo ADD CONSTRAINT tareas_equipo_descripcion_check CHECK (char_length(descripcion) <= 4000),
--   ADD CONSTRAINT tareas_equipo_instrucciones_check CHECK (char_length(instrucciones) <= 4000),
--   ADD CONSTRAINT tareas_equipo_criterios_evaluacion_check CHECK (char_length(criterios_evaluacion) <= 2000);
