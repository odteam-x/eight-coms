-- ══════════════════════════════════════════════════════════════════════
--  0021 — Roles operativos: descripción, roles permitidos, preferencias y rol en la asignación
-- ══════════════════════════════════════════════════════════════════════
--
--  DISTINCIONES QUE ESTA MIGRACIÓN CONSERVA (no se mezclan)
--    · Rol FUNCIONAL del sistema: administrador / secretario / miembro (`es_admin`, `tipo_miembro`).
--      No se toca.
--    · Rol OPERATIVO: lo que una persona hace en el equipo (Fotografía, Redacción…): la tabla `roles`.
--      `profiles.rol_id` sigue siendo su rol principal y el que decide su perfil de evaluación.
--    · PERMITIDOS (`persona_roles`): roles que la persona está habilitada para asumir además del
--      principal. Los define la administración.
--    · PREFERENCIAS (`preferencias_rol`): lo que la persona QUIERE hacer, en orden de prioridad, y
--      un rol predeterminado. Los define la propia persona. Es información para quien asigna, nunca
--      una restricción: no impide que se la asigne a otro rol.
--    · ROL EN UNA ASIGNACIÓN (`tareas.rol_id`): lo que hará en ese trabajo concreto. Fuera de sus
--      permitidos solo lo puede fijar la administración (queda marcado `rol_excepcion`).
--
--  QUÉ AÑADE
--    1. `roles.descripcion`, `responsabilidades` y `requisitos`: lo que se carga solo al elegir un rol.
--    2. `persona_roles`: roles permitidos (admin escribe; la persona y su secretaría leen).
--    3. `preferencias_rol` + `guardar_preferencias_rol()`: la persona ordena sus preferencias y elige
--       un predeterminado entre los roles que tiene permitidos. Una sola operación atómica.
--    4. `tareas.rol_id`, `rol_excepcion` y `actividad_id` (opcional) con su validación, y el cambio
--       de rol queda en el historial de la tarea (`tarea_eventos`, tipo 'rol').
--    5. `personas_asignables()`: quién puede recibir una asignación (admin: todos; secretaría: su
--       distrito) con su compatibilidad, preferencia y carga de trabajo, ya filtrado por permisos.
--
--  Requiere 0016 (tareas) y 0018 (actividades). Aplicación manual en el SQL Editor, tras 0020. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Lo que cada rol significa ──────────────────────────────────────
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS descripcion       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responsabilidades TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requisitos        TEXT NOT NULL DEFAULT '';

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_textos_chk') THEN
    ALTER TABLE public.roles ADD CONSTRAINT roles_textos_chk CHECK (
      char_length(descripcion) <= 1000 AND char_length(responsabilidades) <= 2000 AND char_length(requisitos) <= 1000);
  END IF;
END $chk$;

-- ── 2. Roles permitidos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.persona_roles (
  persona_id   UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rol_id       BIGINT NOT NULL REFERENCES public.roles(id)    ON DELETE CASCADE,
  asignado_por UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, rol_id)
);
CREATE INDEX IF NOT EXISTS persona_roles_rol_idx ON public.persona_roles (rol_id);

CREATE OR REPLACE FUNCTION public.persona_roles_fijar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.asignado_por := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.rol_id AND activo) THEN
    RAISE EXCEPTION 'Ese rol no existe o esta inactivo.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persona_roles_fijar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS persona_roles_fijar ON public.persona_roles;
CREATE TRIGGER persona_roles_fijar BEFORE INSERT ON public.persona_roles
  FOR EACH ROW EXECUTE FUNCTION public.persona_roles_fijar();

--  Roles que una persona puede asumir: el principal + los que le habilitaron. Interna: se llama desde
--  funciones SECURITY DEFINER que ya comprobaron quién pregunta.
CREATE OR REPLACE FUNCTION public.roles_permitidos_de(p_persona UUID)
RETURNS SETOF BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT rol_id::BIGINT FROM profiles WHERE id = p_persona AND rol_id IS NOT NULL
  UNION
  SELECT rol_id FROM persona_roles WHERE persona_id = p_persona;
$$;
REVOKE EXECUTE ON FUNCTION public.roles_permitidos_de(UUID) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.persona_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS persona_roles_leer ON public.persona_roles;
CREATE POLICY persona_roles_leer ON public.persona_roles FOR SELECT TO authenticated
  USING (public.is_admin() OR persona_id = auth.uid()
         OR (public.is_secretario() AND persona_id IN (SELECT public.get_district_member_ids())));
DROP POLICY IF EXISTS persona_roles_admin ON public.persona_roles;
CREATE POLICY persona_roles_admin ON public.persona_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.persona_roles FROM anon;

-- ── 3. Preferencias ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.preferencias_rol (
  persona_id        UUID     NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rol_id            BIGINT   NOT NULL REFERENCES public.roles(id)    ON DELETE CASCADE,
  prioridad         SMALLINT NOT NULL CHECK (prioridad BETWEEN 1 AND 12),
  es_predeterminado BOOLEAN  NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, rol_id),
  CONSTRAINT preferencias_rol_prioridad_uk UNIQUE (persona_id, prioridad) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS preferencias_un_predeterminado ON public.preferencias_rol (persona_id) WHERE es_predeterminado;

CREATE OR REPLACE FUNCTION public.preferencias_rol_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.rol_id AND activo) THEN
    RAISE EXCEPTION 'Ese rol no existe o esta inactivo.' USING ERRCODE = '23514';
  END IF;
  -- El predeterminado se elige entre los roles que la persona tiene permitidos.
  IF NEW.es_predeterminado AND NEW.rol_id NOT IN (SELECT public.roles_permitidos_de(NEW.persona_id)) THEN
    RAISE EXCEPTION 'El rol predeterminado debe estar entre los roles que tienes permitidos.' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preferencias_rol_validar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preferencias_rol_validar ON public.preferencias_rol;
CREATE TRIGGER preferencias_rol_validar BEFORE INSERT OR UPDATE ON public.preferencias_rol
  FOR EACH ROW EXECUTE FUNCTION public.preferencias_rol_validar();

ALTER TABLE public.preferencias_rol ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preferencias_rol_leer ON public.preferencias_rol;
CREATE POLICY preferencias_rol_leer ON public.preferencias_rol FOR SELECT TO authenticated
  USING (public.is_admin() OR persona_id = auth.uid()
         OR (public.is_secretario() AND persona_id IN (SELECT public.get_district_member_ids())));
-- Sin políticas de escritura: se guarda con guardar_preferencias_rol(), que valida y reemplaza de una vez.
REVOKE ALL ON public.preferencias_rol FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.preferencias_rol FROM authenticated;

--  p_roles: roles en orden de preferencia (el primero es el más deseado). p_predeterminado: uno de ellos
--  (o NULL). Reemplaza TODAS las preferencias de quien llama, en una sola transacción.
CREATE OR REPLACE FUNCTION public.guardar_preferencias_rol(p_roles BIGINT[], p_predeterminado BIGINT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_roles BIGINT[];
  i INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  -- Sin repetidos, conservando el orden.
  SELECT COALESCE(array_agg(r ORDER BY pos), '{}') INTO v_roles
    FROM (SELECT r, MIN(pos) AS pos FROM unnest(COALESCE(p_roles, '{}')) WITH ORDINALITY AS t(r, pos) GROUP BY r) x;
  IF array_length(v_roles, 1) > 8 THEN
    RAISE EXCEPTION 'Puedes elegir hasta 8 roles de preferencia.' USING ERRCODE = '23514';
  END IF;
  IF p_predeterminado IS NOT NULL AND NOT (p_predeterminado = ANY (v_roles)) THEN
    RAISE EXCEPTION 'El rol predeterminado debe ser uno de tus roles de preferencia.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM preferencias_rol WHERE persona_id = v_uid;
  FOR i IN 1 .. COALESCE(array_length(v_roles, 1), 0) LOOP
    INSERT INTO preferencias_rol (persona_id, rol_id, prioridad, es_predeterminado)
    VALUES (v_uid, v_roles[i], i, p_predeterminado IS NOT NULL AND v_roles[i] = p_predeterminado);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardar_preferencias_rol(BIGINT[], BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_preferencias_rol(BIGINT[], BIGINT) TO authenticated;

--  Si a una persona le quitan un rol permitido (o cambia su rol principal) y ese era su predeterminado,
--  el predeterminado se limpia: la preferencia en si se conserva, solo deja de ser «el de siempre».
CREATE OR REPLACE FUNCTION public.preferencias_limpiar_predeterminado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_persona UUID;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN v_persona := NEW.id; ELSE v_persona := OLD.persona_id; END IF;
  UPDATE preferencias_rol SET es_predeterminado = false
   WHERE persona_id = v_persona AND es_predeterminado
     AND rol_id NOT IN (SELECT public.roles_permitidos_de(v_persona));
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preferencias_limpiar_predeterminado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS persona_roles_limpiar ON public.persona_roles;
CREATE TRIGGER persona_roles_limpiar AFTER DELETE ON public.persona_roles
  FOR EACH ROW EXECUTE FUNCTION public.preferencias_limpiar_predeterminado();
DROP TRIGGER IF EXISTS profiles_rol_limpiar ON public.profiles;
CREATE TRIGGER profiles_rol_limpiar AFTER UPDATE OF rol_id ON public.profiles
  FOR EACH ROW WHEN (OLD.rol_id IS DISTINCT FROM NEW.rol_id)
  EXECUTE FUNCTION public.preferencias_limpiar_predeterminado();

-- ── 4. Rol y actividad en una tarea ───────────────────────────────────
ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS rol_id        BIGINT  REFERENCES public.roles(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rol_excepcion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actividad_id  BIGINT  REFERENCES public.actividades(id);
CREATE INDEX IF NOT EXISTS tareas_actividad_idx ON public.tareas (actividad_id) WHERE actividad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tareas_rol_idx       ON public.tareas (rol_id)       WHERE rol_id IS NOT NULL;

--  Una actividad con tareas vinculadas no se borra: poner NULL en cascada pasaria por los guardias de
--  `tareas` (una tarea aprobada es historia y no se toca). Se pide desvincular primero, con un mensaje claro.
CREATE OR REPLACE FUNCTION public.actividades_no_borrar_con_tareas()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM tareas WHERE actividad_id = OLD.id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Esta actividad tiene % tarea(s) vinculada(s): desvinculalas antes de borrarla.', v_n USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.actividades_no_borrar_con_tareas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS actividades_no_borrar_con_tareas ON public.actividades;
CREATE TRIGGER actividades_no_borrar_con_tareas BEFORE DELETE ON public.actividades
  FOR EACH ROW EXECUTE FUNCTION public.actividades_no_borrar_con_tareas();

ALTER TABLE public.tarea_eventos DROP CONSTRAINT IF EXISTS tarea_eventos_tipo_check;
ALTER TABLE public.tarea_eventos ADD CONSTRAINT tarea_eventos_tipo_check CHECK (tipo IN ('creada','estado','prorroga','rol'));

CREATE OR REPLACE FUNCTION public.tareas_rol_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_gestion BIGINT; v_nom_viejo TEXT; v_nom_nuevo TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rol_id IS DISTINCT FROM OLD.rol_id THEN
    -- Cambiar el rol es editar el contenido: quien revisa, el admin, o el autor de su propia tarea abierta.
    IF NOT (public.is_admin() OR public.puede_revisar_tarea(OLD.asignada_a)
            OR (OLD.asignada_a = v_uid AND OLD.origen = 'propia' AND OLD.estado <> 'aprobada')) THEN
      RAISE EXCEPTION 'No puedes cambiar el rol de una tarea que te asignaron.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.actividad_id IS DISTINCT FROM OLD.actividad_id THEN
    IF NOT (public.is_admin() OR public.puede_revisar_tarea(OLD.asignada_a)
            OR (OLD.asignada_a = v_uid AND OLD.origen = 'propia' AND OLD.estado <> 'aprobada')) THEN
      RAISE EXCEPTION 'No puedes cambiar la actividad de una tarea que te asignaron.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.rol_id IS NOT DISTINCT FROM OLD.rol_id THEN
    -- El rol no cambia: se conserva tal cual (y su marca de excepcion), aunque despues
    -- le hayan quitado ese rol a la persona. Cambiar de estado no debe romperse por eso.
    NEW.rol_excepcion := OLD.rol_excepcion;
  ELSIF NEW.rol_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.rol_id AND activo) THEN
      RAISE EXCEPTION 'Ese rol no existe o esta inactivo.' USING ERRCODE = '23514';
    END IF;
    IF NEW.rol_id IN (SELECT public.roles_permitidos_de(NEW.asignada_a)) THEN
      NEW.rol_excepcion := false;
    ELSIF public.is_admin() THEN
      NEW.rol_excepcion := true;       -- la administracion puede asignar fuera de lo permitido; queda a la vista
    ELSE
      RAISE EXCEPTION 'Esa persona no tiene permitido ese rol: pide a la administracion que se lo habilite o elige otro.' USING ERRCODE = '42501';
    END IF;
  ELSE
    NEW.rol_excepcion := false;
  END IF;

  IF NEW.actividad_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.actividad_id IS DISTINCT FROM OLD.actividad_id) THEN
    SELECT p.gestion_id INTO v_gestion FROM periodos_evaluacion p WHERE p.id = NEW.periodo_id;
    IF NOT EXISTS (SELECT 1 FROM actividades a WHERE a.id = NEW.actividad_id AND a.gestion_id = v_gestion) THEN
      RAISE EXCEPTION 'La actividad no pertenece a la gestion de este periodo.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.rol_id IS DISTINCT FROM OLD.rol_id THEN
    SELECT nombre INTO v_nom_viejo FROM roles WHERE id = OLD.rol_id;
    SELECT nombre INTO v_nom_nuevo FROM roles WHERE id = NEW.rol_id;
    INSERT INTO tarea_eventos (tarea_id, actor_id, tipo, de, a)
    VALUES (NEW.id, v_uid, 'rol', COALESCE(v_nom_viejo, 'sin rol'), COALESCE(v_nom_nuevo, 'sin rol'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_rol_validar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_rol_validar ON public.tareas;
CREATE TRIGGER tareas_rol_validar BEFORE INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_rol_validar();

-- ── 5. Quién puede recibir una asignación ─────────────────────────────
--  Administración: todas las personas aprobadas que no son admin. Secretaría: su distrito (menos ella).
--  Cualquier otra persona: nada. `p_rol` opcional calcula la compatibilidad con ese rol.
CREATE OR REPLACE FUNCTION public.personas_asignables(p_periodo UUID, p_rol BIGINT DEFAULT NULL)
RETURNS TABLE (
  persona_id UUID, nombre TEXT, email TEXT, distrito TEXT, tipo_miembro TEXT,
  rol_id BIGINT, rol_nombre TEXT, activo_periodo BOOLEAN,
  permitido BOOLEAN, prioridad SMALLINT, predeterminado BOOLEAN,
  tareas_abiertas INT, tareas_vencidas INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_admin BOOLEAN; v_sec BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  v_sec   := public.is_secretario();
  IF NOT (v_admin OR v_sec) THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id, COALESCE(NULLIF(p.nombre, ''), p.email), p.email, p.distrito, COALESCE(p.tipo_miembro, 'miembro'),
         p.rol_id::BIGINT, r.nombre,
         NOT EXISTS (SELECT 1 FROM periodo_participantes pp WHERE pp.periodo_id = p_periodo AND pp.user_id = p.id AND NOT pp.activo),
         CASE WHEN p_rol IS NULL THEN NULL ELSE p_rol IN (SELECT public.roles_permitidos_de(p.id)) END,
         CASE WHEN p_rol IS NULL THEN NULL ELSE (SELECT pr.prioridad FROM preferencias_rol pr WHERE pr.persona_id = p.id AND pr.rol_id = p_rol) END,
         CASE WHEN p_rol IS NULL THEN NULL ELSE COALESCE((SELECT pr.es_predeterminado FROM preferencias_rol pr WHERE pr.persona_id = p.id AND pr.rol_id = p_rol), false) END,
         (SELECT COUNT(*)::INT FROM tareas t WHERE t.asignada_a = p.id AND t.periodo_id = p_periodo AND t.estado IN ('asignada','en_curso','devuelta','bloqueada')),
         (SELECT COUNT(*)::INT FROM tareas t WHERE t.asignada_a = p.id AND t.periodo_id = p_periodo AND t.estado IN ('asignada','en_curso','devuelta') AND t.fecha_limite < CURRENT_DATE)
    FROM profiles p
    LEFT JOIN roles r ON r.id = p.rol_id
   WHERE NOT COALESCE(p.es_admin, false)
     AND COALESCE(p.aprobado, true)
     AND (v_admin OR (p.id <> auth.uid() AND p.id IN (SELECT public.get_district_member_ids())))
   ORDER BY COALESCE(NULLIF(p.nombre, ''), p.email);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.personas_asignables(UUID, BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.personas_asignables(UUID, BIGINT) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar)
-- ══════════════════════════════════════════════════════════════════════
--   SELECT column_name FROM information_schema.columns WHERE table_name='roles' AND column_name IN ('descripcion','responsabilidades','requisitos');
--   SELECT count(*) FROM persona_roles;           -- 0 al principio: cada persona solo tiene permitido su rol principal
-- Nada cambia para quien no use las funciones nuevas.
-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (comentado)
-- DROP TRIGGER actividades_no_borrar_con_tareas ON actividades; DROP FUNCTION actividades_no_borrar_con_tareas();
-- DROP TRIGGER persona_roles_limpiar ON persona_roles; DROP TRIGGER profiles_rol_limpiar ON profiles; DROP FUNCTION preferencias_limpiar_predeterminado();
-- DROP TRIGGER tareas_rol_validar ON tareas; DROP FUNCTION tareas_rol_validar(); DROP FUNCTION personas_asignables(UUID, BIGINT);
-- ALTER TABLE tareas DROP COLUMN rol_id, DROP COLUMN rol_excepcion, DROP COLUMN actividad_id;
-- DROP FUNCTION guardar_preferencias_rol(BIGINT[], BIGINT); DROP TABLE preferencias_rol; DROP TABLE persona_roles;
-- DROP FUNCTION roles_permitidos_de(UUID); ALTER TABLE roles DROP COLUMN descripcion, DROP COLUMN responsabilidades, DROP COLUMN requisitos;
