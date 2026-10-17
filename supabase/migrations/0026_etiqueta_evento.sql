-- ══════════════════════════════════════════════════════════════════════
--  0026 — La etiqueta de partida «Hito» pasa a llamarse «Evento»
-- ══════════════════════════════════════════════════════════════════════
--  «Hito» sonaba a gestión de proyectos; en el calendario se entiende mejor «Evento».
--    · Las gestiones existentes: se renombra su etiqueta «Hito» (con su color y sus actividades) a «Evento».
--      Si una gestión ya tiene una etiqueta «Evento», no se toca (no hay dos con el mismo nombre).
--    · Las gestiones nuevas se siembran con «Evento» (sembrar_etiquetas).
--  No cambia ninguna actividad ni ningún color. Requiere 0018. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.etiquetas e SET nombre = 'Evento'
 WHERE e.nombre = 'Hito'
   AND NOT EXISTS (SELECT 1 FROM public.etiquetas x WHERE x.gestion_id = e.gestion_id AND x.nombre = 'Evento');

CREATE OR REPLACE FUNCTION public.sembrar_etiquetas(p_gestion BIGINT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO etiquetas (gestion_id, nombre, tono, orden) VALUES
    (p_gestion, 'Entrega',      'coral',   1),
    (p_gestion, 'Jornada',      'violeta', 2),
    (p_gestion, 'Capacitación', 'verde',   3),
    (p_gestion, 'Reunión',      'ambar',   4),
    (p_gestion, 'Evento',       'cian',    5)
  ON CONFLICT (gestion_id, nombre) DO NOTHING;
$$;
REVOKE EXECUTE ON FUNCTION public.sembrar_etiquetas(BIGINT) FROM PUBLIC, anon, authenticated;

COMMIT;

-- DESHACER (comentado)
-- UPDATE etiquetas SET nombre = 'Hito' WHERE nombre = 'Evento' AND tono = 'cian';
