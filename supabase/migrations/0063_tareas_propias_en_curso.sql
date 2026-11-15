-- ══════════════════════════════════════════════════════════════════════
--  0063 — Tareas de iniciativa propia: nacen «En curso» (no hay que activarlas)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  Toda tarea nacía «Asignada» y su dueña tenía que tocar «Empezar». Para una tarea que la propia persona creó («Mi iniciativa»)
--  ese paso sobra: ya decidió hacerla.
--
--  QUÉ HACE
--  En el INSERT, si la tarea es para quien la crea (origen = 'propia'), el servidor la deja en `en_curso`. Las asignadas por otra
--  persona siguen naciendo `asignada`. Se parchea `tareas_validar_insert()` con pg_get_functiondef (una sola línea cambia), así que
--  no se reescribe la función ni se pierde ninguna validación. Idempotente: si ya está parcheada, no hace nada.
--
--  QUÉ NO CAMBIA
--  Quién puede crear qué, la regla «nadie aprueba su propia tarea», las notas, el historial y las tareas ya creadas.
--  (Las propias que ya estén «Asignada» siguen así hasta que su dueña toque «Empezar»; ver el UPDATE opcional al final.)
--
--  Aplicación manual en el SQL Editor. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

DO $m63$
DECLARE
  v_def TEXT;
  v_old CONSTANT TEXT := E'NEW.estado                := ''asignada'';';
  v_new CONSTANT TEXT := E'NEW.estado                := CASE WHEN NEW.origen = ''propia'' THEN ''en_curso'' ELSE ''asignada'' END;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tareas_validar_insert';
  IF v_def IS NULL THEN
    RAISE NOTICE '0063: tareas_validar_insert no existe (falta 0016): nada que hacer.';
    RETURN;
  END IF;
  IF position('''en_curso'' ELSE ''asignada''' IN v_def) > 0 THEN
    RAISE NOTICE '0063: ya estaba aplicada.';
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '0063: no se encontró la línea de estado inicial en tareas_validar_insert(); revisa la definición actual.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $m63$;

-- ── Opcional (NO se ejecuta solo): pasar a «En curso» las propias que hoy siguen «Asignada» y sin tocar ──
-- ALTER TABLE public.tareas DISABLE TRIGGER USER;
-- UPDATE public.tareas SET estado = 'en_curso' WHERE origen = 'propia' AND estado = 'asignada';
-- ALTER TABLE public.tareas ENABLE TRIGGER USER;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- Reaplicar la definición de tareas_validar_insert() de 0016 (línea «NEW.estado := 'asignada';»).
