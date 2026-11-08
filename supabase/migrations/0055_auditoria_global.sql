-- ══════════════════════════════════════════════════════════════════════
--  0055 — Centro de auditoría: registro global de acciones sensibles (hallazgo H-03; PDF §9, §4.3)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  Cada módulo guardaba su historia por separado (tareas, equipos, notas, reglas del PE, evaluaciones 0053,
--  estadísticas 0054) y NO había ninguna vista conjunta. Además no se registraba nada de: privilegios de las
--  personas (rol funcional, distrito, aprobado, admin), borrado de personas, activar un período o abrir/archivar
--  una gestión, ni las evaluaciones de distrito.
--
--  QUÉ HACE
--  · `auditoria_global` (append-only, SIN permisos de cliente): lo que antes no dejaba rastro, escrito por triggers
--    (quién, qué, antes/después, cuándo). Nunca guarda correos, contraseñas ni textos de comentarios.
--  · `auditoria_listar(desde, hasta, origen, buscar, limite, offset)` (SECURITY DEFINER, SOLO administración):
--    UNE `auditoria_global` con los historiales que ya existen. Para los existentes NO copia datos: los lee donde
--    están. Cada historial se incluye solo si su tabla existe (funciona con 0031–0036, 0053 y 0054 aplicadas o no).
--
--  QUÉ NO CAMBIA: ninguna tabla de negocio, política ni resultado. Los triggers son AFTER y no pueden impedir
--  ni modificar una operación; si el registro fallara, la operación sigue (EXCEPTION → se ignora).
--
--  APLICAR después de 0054 (no la exige: lo que falte, simplemente no aparece). Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.auditoria_global (
  id         BIGSERIAL   PRIMARY KEY,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen     TEXT        NOT NULL,             -- Personas | Períodos | Gestiones | Distritos
  accion     TEXT        NOT NULL,
  actor_id   UUID,                             -- auth.uid(); NULL = sin sesión (SQL Editor / mantenimiento)
  objeto     TEXT        NOT NULL,             -- texto legible: «Persona: Ana Pérez», «Período: PE3»
  objeto_id  TEXT,
  resumen    TEXT,
  antes      JSONB,
  despues    JSONB,
  motivo     TEXT
);
CREATE INDEX IF NOT EXISTS auditoria_global_fecha_idx ON public.auditoria_global (creado_en DESC);
ALTER TABLE public.auditoria_global ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_global FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.auditoria_global_id_seq FROM PUBLIC, anon, authenticated;

-- ── Registro (interno) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._auditar(p_origen TEXT, p_accion TEXT, p_objeto TEXT, p_objeto_id TEXT,
                                           p_resumen TEXT, p_antes JSONB, p_despues JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    INSERT INTO public.auditoria_global (origen, accion, actor_id, objeto, objeto_id, resumen, antes, despues)
    VALUES (p_origen, p_accion, auth.uid(), left(p_objeto, 200), p_objeto_id, left(p_resumen, 300), p_antes, p_despues);
  EXCEPTION WHEN OTHERS THEN NULL;     -- auditar nunca debe impedir la operación
  END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._auditar(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- ── Personas: privilegios y borrado ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_trg_personas() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a JSONB; d JSONB; cambios TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._auditar('Personas', 'persona_borrada', 'Persona: ' || COALESCE(OLD.nombre, '—'), OLD.id::TEXT,
      'Se eliminó el perfil', jsonb_build_object('es_admin', OLD.es_admin, 'tipo_miembro', OLD.tipo_miembro, 'distrito', OLD.distrito, 'rol_id', OLD.rol_id), NULL);
    RETURN OLD;
  END IF;
  IF NEW.es_admin IS DISTINCT FROM OLD.es_admin THEN cambios := array_append(cambios, 'administrador'); END IF;
  IF NEW.tipo_miembro IS DISTINCT FROM OLD.tipo_miembro THEN cambios := array_append(cambios, 'tipo de miembro'); END IF;
  IF NEW.distrito IS DISTINCT FROM OLD.distrito THEN cambios := array_append(cambios, 'distrito'); END IF;
  IF NEW.rol_id IS DISTINCT FROM OLD.rol_id THEN cambios := array_append(cambios, 'rol'); END IF;
  IF to_jsonb(NEW) ? 'aprobado' AND (to_jsonb(NEW)->>'aprobado') IS DISTINCT FROM (to_jsonb(OLD)->>'aprobado') THEN cambios := array_append(cambios, 'acceso'); END IF;
  IF array_length(cambios, 1) IS NULL THEN RETURN NEW; END IF;
  a := jsonb_build_object('es_admin', OLD.es_admin, 'tipo_miembro', OLD.tipo_miembro, 'distrito', OLD.distrito, 'rol_id', OLD.rol_id, 'aprobado', to_jsonb(OLD)->'aprobado');
  d := jsonb_build_object('es_admin', NEW.es_admin, 'tipo_miembro', NEW.tipo_miembro, 'distrito', NEW.distrito, 'rol_id', NEW.rol_id, 'aprobado', to_jsonb(NEW)->'aprobado');
  PERFORM public._auditar('Personas', 'persona_cambio', 'Persona: ' || COALESCE(NEW.nombre, '—'), NEW.id::TEXT,
                          'Cambió: ' || array_to_string(cambios, ', '), a, d);
  RETURN NEW;
END;
$$;

-- ── Períodos ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_trg_periodos() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._auditar('Períodos', 'periodo_creado', 'Período: ' || NEW.nombre, NEW.id::TEXT, 'Se creó el período', NULL, jsonb_build_object('activo', NEW.activo));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._auditar('Períodos', 'periodo_borrado', 'Período: ' || OLD.nombre, OLD.id::TEXT, 'Se eliminó el período', jsonb_build_object('activo', OLD.activo), NULL);
    RETURN OLD;
  END IF;
  IF NEW.activo IS DISTINCT FROM OLD.activo THEN
    PERFORM public._auditar('Períodos', CASE WHEN NEW.activo THEN 'periodo_activado' ELSE 'periodo_desactivado' END,
      'Período: ' || NEW.nombre, NEW.id::TEXT, CASE WHEN NEW.activo THEN 'Pasó a ser el período activo' ELSE 'Dejó de ser el período activo' END,
      jsonb_build_object('activo', OLD.activo), jsonb_build_object('activo', NEW.activo));
  END IF;
  RETURN NEW;
END;
$$;

-- ── Gestiones ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_trg_gestiones() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._auditar('Gestiones', 'gestion_creada', 'Gestión: ' || NEW.nombre, NEW.id::TEXT, 'Se creó la gestión', NULL,
      jsonb_build_object('activa', NEW.activa, 'archivada', NEW.archivada));
    RETURN NEW;
  END IF;
  IF NEW.activa IS DISTINCT FROM OLD.activa OR NEW.archivada IS DISTINCT FROM OLD.archivada THEN
    PERFORM public._auditar('Gestiones', CASE WHEN NEW.archivada AND NOT OLD.archivada THEN 'gestion_archivada'
                                              WHEN NEW.activa AND NOT OLD.activa THEN 'gestion_abierta' ELSE 'gestion_cambio' END,
      'Gestión: ' || NEW.nombre, NEW.id::TEXT, 'Activa: ' || NEW.activa || ' · Archivada: ' || NEW.archivada,
      jsonb_build_object('activa', OLD.activa, 'archivada', OLD.archivada), jsonb_build_object('activa', NEW.activa, 'archivada', NEW.archivada));
  END IF;
  RETURN NEW;
END;
$$;

-- ── Evaluaciones de distrito (sin los textos de los comentarios) ──────
CREATE OR REPLACE FUNCTION public.auditoria_trg_eval_distrito() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE per TEXT;
BEGIN
  SELECT nombre INTO per FROM public.periodos_evaluacion WHERE id = COALESCE(NEW.periodo_id, OLD.periodo_id);
  IF TG_OP = 'INSERT' THEN
    PERFORM public._auditar('Distritos', CASE WHEN NEW.estado = 'publicado' THEN 'distrito_publicado' ELSE 'distrito_borrador' END,
      'Evaluación de distrito ' || NEW.distrito_id || ' · ' || COALESCE(per, ''), NEW.id::TEXT, 'Estado: ' || NEW.estado, NULL,
      jsonb_build_object('estado', NEW.estado, 'puntajes', NEW.puntajes));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._auditar('Distritos', 'distrito_borrado', 'Evaluación de distrito ' || OLD.distrito_id || ' · ' || COALESCE(per, ''), OLD.id::TEXT,
      'Se eliminó (estado: ' || OLD.estado || ')', jsonb_build_object('estado', OLD.estado, 'puntajes', OLD.puntajes), NULL);
    RETURN OLD;
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado OR NEW.puntajes IS DISTINCT FROM OLD.puntajes THEN
    PERFORM public._auditar('Distritos', CASE WHEN NEW.estado IS DISTINCT FROM OLD.estado THEN 'distrito_estado' ELSE 'distrito_corregido' END,
      'Evaluación de distrito ' || NEW.distrito_id || ' · ' || COALESCE(per, ''), NEW.id::TEXT, 'Estado: ' || OLD.estado || ' → ' || NEW.estado,
      jsonb_build_object('estado', OLD.estado, 'puntajes', OLD.puntajes), jsonb_build_object('estado', NEW.estado, 'puntajes', NEW.puntajes));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auditoria_trg_personas(), public.auditoria_trg_periodos(), public.auditoria_trg_gestiones(),
  public.auditoria_trg_eval_distrito() FROM PUBLIC, anon, authenticated;

-- Los triggers solo se crean donde la tabla existe (la base de pruebas no tiene todas).
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS auditoria_personas ON public.profiles;
    CREATE TRIGGER auditoria_personas AFTER UPDATE OR DELETE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.auditoria_trg_personas();
  END IF;
  IF to_regclass('public.periodos_evaluacion') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS auditoria_periodos ON public.periodos_evaluacion;
    CREATE TRIGGER auditoria_periodos AFTER INSERT OR UPDATE OF activo OR DELETE ON public.periodos_evaluacion
      FOR EACH ROW EXECUTE FUNCTION public.auditoria_trg_periodos();
  END IF;
  IF to_regclass('public.gestiones') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS auditoria_gestiones ON public.gestiones;
    CREATE TRIGGER auditoria_gestiones AFTER INSERT OR UPDATE ON public.gestiones
      FOR EACH ROW EXECUTE FUNCTION public.auditoria_trg_gestiones();
  END IF;
  IF to_regclass('public.evaluaciones_distrito') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS auditoria_eval_distrito ON public.evaluaciones_distrito;
    CREATE TRIGGER auditoria_eval_distrito AFTER INSERT OR UPDATE OR DELETE ON public.evaluaciones_distrito
      FOR EACH ROW EXECUTE FUNCTION public.auditoria_trg_eval_distrito();
  END IF;
END $$;

-- ── Lectura unificada (solo administración) ───────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_listar(
  p_desde  TIMESTAMPTZ DEFAULT NULL,
  p_hasta  TIMESTAMPTZ DEFAULT NULL,
  p_origen TEXT        DEFAULT NULL,
  p_buscar TEXT        DEFAULT NULL,
  p_limite INT         DEFAULT 50,
  p_offset INT         DEFAULT 0
) RETURNS TABLE (
  total BIGINT, creado_en TIMESTAMPTZ, origen TEXT, accion TEXT, actor_id UUID, actor_nombre TEXT,
  objeto TEXT, resumen TEXT, motivo TEXT, detalle JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_partes TEXT[] := ARRAY[]::TEXT[];
  v_sql    TEXT;
  v_lim    INT := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_off    INT := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion consulta la auditoria.' USING ERRCODE = '42501';
  END IF;

  -- Cada parte devuelve las mismas 8 columnas.
  v_partes := array_append(v_partes, $p$SELECT a.creado_en, a.origen, a.accion, a.actor_id, a.objeto, COALESCE(a.resumen, '') resumen, a.motivo,
      jsonb_build_object('antes', a.antes, 'despues', a.despues) detalle FROM public.auditoria_global a$p$);

  IF to_regclass('public.tarea_eventos') IS NOT NULL AND to_regclass('public.tareas') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.created_at, 'Tareas', e.tipo, e.actor_id, 'Tarea: ' || COALESCE(t.titulo, '#' || e.tarea_id),
      COALESCE(e.de, '') || CASE WHEN e.de IS NOT NULL OR e.a IS NOT NULL THEN ' → ' ELSE '' END || COALESCE(e.a, ''), e.motivo,
      jsonb_build_object('tarea_id', e.tarea_id) FROM public.tarea_eventos e LEFT JOIN public.tareas t ON t.id = e.tarea_id$p$);
  END IF;
  IF to_regclass('public.tarea_equipo_eventos') IS NOT NULL AND to_regclass('public.tareas_equipo') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.created_at, 'Tareas de equipo', e.tipo, e.actor_id, 'Tarea de equipo: ' || COALESCE(t.titulo, '#' || e.tarea_id),
      COALESCE(e.de, '') || CASE WHEN e.de IS NOT NULL OR e.a IS NOT NULL THEN ' → ' ELSE '' END || COALESCE(e.a, ''), e.motivo,
      jsonb_build_object('tarea_id', e.tarea_id, 'persona_id', e.persona_id)
      FROM public.tarea_equipo_eventos e LEFT JOIN public.tareas_equipo t ON t.id = e.tarea_id$p$);
  END IF;
  IF to_regclass('public.equipo_eventos') IS NOT NULL AND to_regclass('public.equipos') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.created_at, 'Equipos', e.tipo, e.actor_id, 'Equipo: ' || COALESCE(q.nombre, '#' || e.equipo_id),
      left(e.detalle::TEXT, 200), e.motivo, jsonb_build_object('equipo_id', e.equipo_id, 'persona_id', e.persona_id, 'detalle', e.detalle)
      FROM public.equipo_eventos e LEFT JOIN public.equipos q ON q.id = e.equipo_id$p$);
  END IF;
  IF to_regclass('public.calificaciones_historial') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.created_at, 'Notas de tareas', e.accion, e.actor_id, 'Nota de tarea ' || e.tarea_tipo || ' #' || e.tarea_id,
      COALESCE(e.puntos_anterior::TEXT, '—') || ' → ' || COALESCE(e.puntos_nuevo::TEXT, '—'), e.motivo,
      jsonb_build_object('persona_id', e.persona_id, 'contexto', e.contexto) FROM public.calificaciones_historial e$p$);
  END IF;
  IF to_regclass('public.periodo_calif_config_hist') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.created_at, 'Reglas del PE', 'reglas_cambiadas', e.actor_id, 'Reglas del período ' || COALESCE(p.nombre, ''),
      left(COALESCE(e.antes::TEXT, '—') || ' → ' || e.despues::TEXT, 300), e.motivo, jsonb_build_object('antes', e.antes, 'despues', e.despues)
      FROM public.periodo_calif_config_hist e LEFT JOIN public.periodos_evaluacion p ON p.id = e.periodo_id$p$);
  END IF;
  IF to_regclass('public.evaluaciones_versiones') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.creado_en, 'Evaluaciones', 'evaluacion_' || e.accion, e.actor,
      'Evaluación de ' || COALESCE(pf.nombre, '—') || ' · ' || COALESCE(p.nombre, ''), 'Versión ' || e.version, e.motivo,
      jsonb_build_object('antes', e.antes, 'despues', e.despues, 'resultado_antes', e.resultado_antes, 'resultado_despues', e.resultado_despues)
      FROM public.evaluaciones_versiones e LEFT JOIN public.profiles pf ON pf.id = e.evaluado_id
      LEFT JOIN public.periodos_evaluacion p ON p.id = e.periodo_id$p$);
  END IF;
  IF to_regclass('public.estadisticas_distrito_hist') IS NOT NULL THEN
    v_partes := array_append(v_partes, $p$SELECT e.cambiado_en, 'Estadísticas de Instagram', 'estadisticas_' || e.accion, e.cambiado_por,
      'Estadísticas ' || e.distrito_id || ' · ' || COALESCE(p.nombre, ''), 'Valor anterior: ' || COALESCE(e.visualizaciones::TEXT, '—') || ' visualizaciones', NULL::TEXT,
      jsonb_build_object('captura_anterior', e.captura_path, 'subido_por', e.subido_por_nombre)
      FROM public.estadisticas_distrito_hist e LEFT JOIN public.periodos_evaluacion p ON p.id = e.periodo_id$p$);
  END IF;

  v_sql := 'WITH u(creado_en, origen, accion, actor_id, objeto, resumen, motivo, detalle) AS (' || array_to_string(v_partes, ' UNION ALL ') || ')
    SELECT count(*) OVER ()::BIGINT, u.creado_en, u.origen, u.accion, u.actor_id, pf.nombre, u.objeto, u.resumen, u.motivo, u.detalle
      FROM u LEFT JOIN public.profiles pf ON pf.id = u.actor_id
     WHERE ($1 IS NULL OR u.creado_en >= $1) AND ($2 IS NULL OR u.creado_en < $2) AND ($3 IS NULL OR u.origen = $3)
       AND ($4 IS NULL OR u.accion ILIKE ''%'' || $4 || ''%'' OR u.objeto ILIKE ''%'' || $4 || ''%'' OR u.resumen ILIKE ''%'' || $4 || ''%''
            OR COALESCE(u.motivo, '''') ILIKE ''%'' || $4 || ''%'' OR COALESCE(pf.nombre, '''') ILIKE ''%'' || $4 || ''%'')
     ORDER BY u.creado_en DESC, u.objeto LIMIT $5 OFFSET $6';
  RETURN QUERY EXECUTE v_sql USING p_desde, p_hasta, NULLIF(btrim(p_origen), ''), NULLIF(btrim(replace(replace(COALESCE(p_buscar, ''), '%', ''), '_', '')), ''), v_lim, v_off;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.auditoria_listar(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auditoria_listar(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) TO authenticated;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS auditoria_personas ON public.profiles;
-- DROP TRIGGER IF EXISTS auditoria_periodos ON public.periodos_evaluacion;
-- DROP TRIGGER IF EXISTS auditoria_gestiones ON public.gestiones;
-- DROP TRIGGER IF EXISTS auditoria_eval_distrito ON public.evaluaciones_distrito;
-- DROP FUNCTION IF EXISTS public.auditoria_listar(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT);
-- DROP FUNCTION IF EXISTS public.auditoria_trg_personas(), public.auditoria_trg_periodos(), public.auditoria_trg_gestiones(), public.auditoria_trg_eval_distrito();
-- DROP FUNCTION IF EXISTS public._auditar(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);
-- (conservar auditoria_global como registro; si se quiere: DROP TABLE public.auditoria_global;)
