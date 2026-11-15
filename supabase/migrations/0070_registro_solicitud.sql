-- ══════════════════════════════════════════════════════════════════════
--  0070 — Registro completo: la persona pide su distrito (o «invitado externo») y hasta 2 roles; al aprobarla, entra ya configurada
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  Quien se registraba quedaba «sin rol, sin distrito, sin nada» y la administración tenía que configurarle todo a mano
--  después de aprobarla.
--
--  QUÉ HACE (sin abrir ningún agujero: lo que la persona escribe es una SOLICITUD, no un permiso)
--  1. `profiles` gana tres columnas de solicitud: `solicitud_distrito` (un distrito de la lista, incluido «EXT» = invitado externo),
--     `solicitud_rol_id` y `solicitud_rol2_id`. Las rellena SOLO el disparador de alta (`handle_new_user`) a partir de los datos
--     del registro, y solo si son válidos (distrito activo que existe, roles que existen, el segundo distinto del primero).
--     El perfil nace igual que siempre: tipo «miembro», sin distrito, sin rol, sin acceso aprobado.
--  2. `registro_opciones()` (pública, solo lectura): la lista de distritos activos (con «EXT» / invitado externo) y de roles activos.
--  3. Al APROBAR (aprobado pasa de falso a verdadero) un disparador aplica la solicitud a lo que esté vacío: distrito, rol principal y el
--     segundo rol (en `persona_roles`, respetando el máximo de 2 roles de 0062). Si la administración ya fijó algo en esa misma
--     aprobación, NO se pisa. SOLO se puede pedir acceso como MIEMBRO: secretaría y administración las asigna siempre la administración.
--  4. Las columnas de solicitud las protege el mismo disparador de privilegios: una persona no las cambia después de registrarse.
--
--  QUÉ NO CAMBIA
--  Nadie obtiene permisos por registrarse; `aprobado`, `tipo_miembro`, `distrito` y `rol_id` siguen congelados para quien no
--  administra. Las personas ya existentes no se tocan (sus columnas de solicitud quedan vacías).
--
--  Requiere 0001 (handle_new_user, profiles) y, para el segundo rol, 0021 y 0062. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columnas de solicitud ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS solicitud_distrito TEXT,
  ADD COLUMN IF NOT EXISTS solicitud_rol_id   BIGINT,
  ADD COLUMN IF NOT EXISTS solicitud_rol2_id  BIGINT;

-- ── 2. Opciones del formulario de registro (pública, solo lectura) ────
CREATE OR REPLACE FUNCTION public.registro_opciones()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_d JSONB := '[]'::jsonb; v_r JSONB := '[]'::jsonb;
BEGIN
  IF to_regclass('public.distritos') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nombre', COALESCE(nombre, id)) ORDER BY id), '[]'::jsonb)
                  FROM public.distritos WHERE COALESCE(activo, true)$q$ INTO v_d;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) ORDER BY nombre), '[]'::jsonb)
    INTO v_r FROM public.roles WHERE COALESCE(activo, true);
  RETURN jsonb_build_object('distritos', v_d, 'roles', v_r);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registro_opciones() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.registro_opciones() TO anon, authenticated;

-- ── 3. Alta: guarda la solicitud (validada), nunca un permiso ─────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_dist TEXT := NULLIF(btrim(m ->> 'distrito'), '');
  v_r1 BIGINT; v_r2 BIGINT; v_ok BOOLEAN;
BEGIN
  -- distrito: solo si existe y está activo
  IF v_dist IS NOT NULL THEN
    IF to_regclass('public.distritos') IS NULL THEN v_dist := NULL;
    ELSE
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.distritos WHERE id::text = $1 AND COALESCE(activo, true))' INTO v_ok USING v_dist;
      IF NOT v_ok THEN v_dist := NULL; END IF;
    END IF;
  END IF;
  -- roles: solo ids que existen; el segundo, distinto del primero
  IF (m ->> 'rol_id') ~ '^[0-9]{1,9}$' THEN
    SELECT id INTO v_r1 FROM public.roles WHERE id = (m ->> 'rol_id')::bigint AND COALESCE(activo, true);
  END IF;
  IF (m ->> 'rol2_id') ~ '^[0-9]{1,9}$' THEN
    SELECT id INTO v_r2 FROM public.roles WHERE id = (m ->> 'rol2_id')::bigint AND COALESCE(activo, true);
  END IF;
  IF v_r1 IS NULL OR v_r2 = v_r1 THEN v_r2 := NULL; END IF;

  INSERT INTO public.profiles (id, email, nombre, tipo_miembro, es_admin, distrito, rol_id, aprobado,
                               solicitud_distrito, solicitud_rol_id, solicitud_rol2_id)
  VALUES (NEW.id, NEW.email,
          COALESCE(NULLIF(btrim(m ->> 'nombre'), ''), SPLIT_PART(NEW.email, '@', 1)),
          'miembro',   -- nunca 'secretario', venga lo que venga en el metadata
          false, NULL, NULL,
          false,       -- requiere aprobación explícita de la administración
          v_dist, v_r1, v_r2)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DO $m70b$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $m70b$;

-- ── 4. Al aprobar: se aplica la solicitud a lo que esté vacío ─────────
CREATE OR REPLACE FUNCTION public.profiles_aplicar_solicitud()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(OLD.aprobado, false) = false AND NEW.aprobado = true THEN
    IF NEW.distrito IS NULL AND NEW.solicitud_distrito IS NOT NULL THEN NEW.distrito := NEW.solicitud_distrito; END IF;
    IF NEW.rol_id   IS NULL AND NEW.solicitud_rol_id   IS NOT NULL THEN NEW.rol_id   := NEW.solicitud_rol_id;   END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_aplicar_solicitud() FROM PUBLIC, anon, authenticated;

-- «zz»: corre DESPUÉS del disparador de privilegios (orden alfabético), que ya dejó pasar a la administración
DROP TRIGGER IF EXISTS profiles_zz_aplicar_solicitud ON public.profiles;
CREATE TRIGGER profiles_zz_aplicar_solicitud
  BEFORE UPDATE OF aprobado ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_aplicar_solicitud();

-- El segundo rol va a `persona_roles` DESPUÉS de guardar la fila (clave foránea); respeta el máximo de 2 roles (0062)
CREATE OR REPLACE FUNCTION public.profiles_aplicar_solicitud_rol2()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(OLD.aprobado, false) = false AND NEW.aprobado = true
     AND NEW.solicitud_rol2_id IS NOT NULL AND NEW.rol_id IS NOT NULL AND NEW.solicitud_rol2_id <> NEW.rol_id
     AND to_regclass('public.persona_roles') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.persona_roles (persona_id, rol_id) VALUES (NEW.id, NEW.solicitud_rol2_id) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;   -- p. ej. ya tiene un segundo rol: la aprobación no se cae por esto
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_aplicar_solicitud_rol2() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_zz_aplicar_solicitud_rol2 ON public.profiles;
CREATE TRIGGER profiles_zz_aplicar_solicitud_rol2
  AFTER UPDATE OF aprobado ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_aplicar_solicitud_rol2();

-- ── 5. Las columnas de solicitud tampoco las cambia quien no administra ─
CREATE OR REPLACE FUNCTION public.profiles_proteger_solicitud()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF NEW.solicitud_distrito IS DISTINCT FROM OLD.solicitud_distrito
     OR NEW.solicitud_rol_id IS DISTINCT FROM OLD.solicitud_rol_id OR NEW.solicitud_rol2_id IS DISTINCT FROM OLD.solicitud_rol2_id THEN
    RAISE EXCEPTION 'La solicitud de registro no se modifica.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_proteger_solicitud() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_proteger_solicitud ON public.profiles;
CREATE TRIGGER profiles_proteger_solicitud BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_proteger_solicitud();

COMMIT;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- DROP TRIGGER profiles_zz_aplicar_solicitud ON public.profiles;  DROP TRIGGER profiles_zz_aplicar_solicitud_rol2 ON public.profiles;
-- DROP TRIGGER profiles_proteger_solicitud ON public.profiles;
-- DROP FUNCTION public.profiles_aplicar_solicitud(), public.profiles_aplicar_solicitud_rol2(), public.profiles_proteger_solicitud(), public.registro_opciones();
-- Reaplicar handle_new_user() de 0001 (sin las columnas de solicitud). Las columnas pueden quedarse (inofensivas).
