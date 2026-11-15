-- ════════════════════════════════════════════════════════════════════════════
--  0062 — Sincronización en tiempo real (Supabase Realtime · postgres_changes)
-- ════════════════════════════════════════════════════════════════════════════
--
--  PEDIDO. Que quien tiene el portal abierto vea los cambios de otras personas sin recargar la página (core/sync.js).
--
--  QUÉ HACE.
--   1. Añade a la publicación `supabase_realtime` las tablas que alimentan las pantallas (lista en la sección 2). Solo se publica una
--      tabla que EXISTE, tiene RLS ACTIVADA y clave primaria: sin RLS Realtime enviaría sus filas a cualquiera con permiso de lectura de
--      la tabla, y sin clave primaria publicar UPDATE/DELETE haría fallar las escrituras de la propia tabla. Si alguna no cumple, se
--      OMITE con un aviso (RAISE WARNING) en vez de publicarla a medias o romper nada.
--   2. Crea `notif_senal`: UNA fila por persona con un contador que sube cuando le llega o lee un aviso. `notificaciones` está cerrada a
--      `authenticated` desde 0019 (lleva errores de correo, intentos, etc.), así que NO se abre; la campana escucha solo esta señal,
--      que no contiene ningún dato del aviso, y entonces pide el contador por la función de siempre.
--   3. REVOKE ALL a `anon` sobre todo lo publicado: Realtime evalúa la RLS con el rol de quien escucha; un anónimo no tiene SELECT,
--      por tanto no recibe nada. (Los eventos DELETE solo llevan la clave primaria: Realtime no puede aplicar RLS a un borrado.)
--
--  QUÉ NO CAMBIA. Ninguna política RLS, ninguna función, ninguna columna existente. No se concede ningún permiso nuevo sobre tablas
--  existentes. Las escrituras siguen exactamente igual (publicar una tabla no cambia quién puede escribirla).
--
--  VERIFICAR DESPUÉS (no se puede probar desde el repositorio):
--     SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 2;
--     Dashboard → Database → Replication / Realtime: «Realtime» habilitado en el proyecto.
--
--  Aplicar DESPUÉS de 0061 (y de las tablas que enumera la sección 2). Idempotente. Reversa al final.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Señal de avisos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notif_senal (
  destinatario_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tic             BIGINT      NOT NULL DEFAULT 0,
  actualizado     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notif_senal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_senal_propia ON public.notif_senal;
CREATE POLICY notif_senal_propia ON public.notif_senal FOR SELECT TO authenticated USING (destinatario_id = auth.uid());
REVOKE ALL ON public.notif_senal FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.notif_senal TO authenticated;         -- solo leer (y solo la propia fila, por la política)

CREATE OR REPLACE FUNCTION public.notif_senal_tocar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.notif_senal AS s (destinatario_id, tic) VALUES (NEW.destinatario_id, 1)
  ON CONFLICT (destinatario_id) DO UPDATE SET tic = s.tic + 1, actualizado = now();
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notif_senal_tocar() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.notificaciones') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notif_senal_ins ON public.notificaciones;
    CREATE TRIGGER notif_senal_ins AFTER INSERT ON public.notificaciones
      FOR EACH ROW EXECUTE FUNCTION public.notif_senal_tocar();
    -- marcar como leída desde otro dispositivo también mueve la campana (la columna existe desde 0022/0040)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notificaciones' AND column_name='leida_en') THEN
      DROP TRIGGER IF EXISTS notif_senal_leida ON public.notificaciones;
      CREATE TRIGGER notif_senal_leida AFTER UPDATE OF leida_en ON public.notificaciones
        FOR EACH ROW WHEN (OLD.leida_en IS DISTINCT FROM NEW.leida_en) EXECUTE FUNCTION public.notif_senal_tocar();
    END IF;
  END IF;
END $$;

-- ── 2. Publicación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'tareas', 'tareas_equipo', 'tarea_equipo_participantes', 'tarea_equipo_aportes', 'calificaciones_historial', 'periodo_calif_config',
    'evaluaciones', 'evaluaciones_versiones', 'evaluaciones_distrito', 'estadisticas_distrito',
    'periodos_evaluacion', 'periodo_participantes', 'gestiones',
    'profiles', 'roles', 'persona_roles', 'perfiles_rol', 'perfil_criterios', 'criterios_v2', 'criterios', 'rubrica',
    'calendario', 'actividades', 'actividad_destinatarios', 'etiquetas',
    'equipos', 'equipo_miembros', 'distritos', 'banco_imagenes', 'trabajos_entregados',
    'notif_senal', 'auditoria_global'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;      -- en Supabase ya existe; esto solo cubre un entorno local
  END IF;
  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publica TODAS las tablas: no hay nada que añadir.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Realtime: la tabla % no existe todavía (se omite).', t;
    ELSIF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE WARNING 'Realtime: % NO tiene RLS: no se publica.', t;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = to_regclass('public.' || t) AND indisprimary) THEN
      RAISE WARNING 'Realtime: % no tiene clave primaria: no se publica (rompería sus UPDATE/DELETE).', t;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);     -- anónimo: nada, ni leer ni escuchar
    END IF;
  END LOOP;
END $$;

-- ── REVERSA ──────────────────────────────────────────────────────────────────
-- Sacar las tablas de la publicación (el portal seguirá funcionando: sin eventos, se ve lo último al navegar o volver a la pestaña):
--   DO $$ DECLARE t TEXT; BEGIN
--     FOR t IN SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' LOOP
--       EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t); END LOOP; END $$;
--   (si el proyecto usaba Realtime para otra cosa, saca solo las tablas de la sección 2)
-- Quitar la señal:
--   DROP TRIGGER IF EXISTS notif_senal_ins ON public.notificaciones;  DROP TRIGGER IF EXISTS notif_senal_leida ON public.notificaciones;
--   DROP FUNCTION IF EXISTS public.notif_senal_tocar();  DROP TABLE IF EXISTS public.notif_senal;
