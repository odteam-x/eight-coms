-- ══════════════════════════════════════════════════════════════════════
--  0003 — Un único período activo, garantizado por la base
--  Idempotente. Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════════
--
--  CONTEXTO (verificado contra la base real):
--
--  · El período activo es PE4 «UN SOLO LATIDO», pero user.html y
--    secretario.html solo tenían botones para PE1/PE2/PE3. El usuario nunca
--    podía llegar a PE4. Eso se arregla en el frontend.
--
--  · La regla «solo un PE activo» se aplicaba con un bucle JS de N updates
--    secuenciales (admin.js). Si uno fallaba quedaban dos activos y
--    find(p => p.activo) tomaba el primero por created_at.
--
--  · `config.periodo_activo` era una tercera fuente de verdad, escrita con
--    un nombre (snake_case) y sembrada con otro (camelCase `periodoActivo`).
--    Si el admin marcaba `activo` directamente en Supabase, la fila nunca se
--    creaba y el portal caía al fallback duro 'PE1'.
--
--  Cambios de esquema: índice parcial único + función set_periodo_activo.
--  Datos: elimina las filas de config que duplicaban el estado.
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. Solo puede haber un período activo ─────────────────────────────
--  Índice parcial: solo indexa las filas con activo = true, y exige que
--  `activo` sea único entre ellas. Como todas valen true, permite una sola.
DROP INDEX IF EXISTS public.periodos_solo_uno_activo;
CREATE UNIQUE INDEX periodos_solo_uno_activo
  ON public.periodos_evaluacion (activo)
  WHERE activo;


-- ── 2. Cambio atómico del período activo ──────────────────────────────
--  Dos UPDATE en una sola función: el índice se evalúa al final de cada
--  statement, así que desactivar-luego-activar nunca lo viola.
--  Pasar NULL desactiva todos (deja la gestión sin período en curso).
CREATE OR REPLACE FUNCTION public.set_periodo_activo(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar el periodo activo.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.periodos_evaluacion
     SET activo = false
   WHERE activo AND (p_id IS NULL OR id <> p_id);

  IF p_id IS NOT NULL THEN
    UPDATE public.periodos_evaluacion
       SET activo = true
     WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No existe el periodo %', p_id USING ERRCODE = 'P0002';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_periodo_activo(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_periodo_activo(UUID) TO authenticated;


-- ── 3. `config` deja de ser fuente de verdad del período activo ───────
--  La única fuente pasa a ser periodos_evaluacion.activo.
DELETE FROM public.config WHERE clave IN ('periodo_activo', 'periodoActivo');


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Debe devolver exactamente 1 fila (PE4):
--   SELECT nombre FROM periodos_evaluacion WHERE activo;
--
-- Debe devolver 0 filas:
--   SELECT clave FROM config WHERE clave IN ('periodo_activo','periodoActivo');
--
-- Debe fallar con "duplicate key" (prueba de que el índice funciona):
--   UPDATE periodos_evaluacion SET activo = true WHERE nombre = 'PE1';


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- DROP FUNCTION IF EXISTS public.set_periodo_activo(UUID);
-- DROP INDEX IF EXISTS public.periodos_solo_uno_activo;
-- INSERT INTO public.config (clave, valor)
--   SELECT 'periodo_activo', nombre FROM public.periodos_evaluacion WHERE activo
--   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
