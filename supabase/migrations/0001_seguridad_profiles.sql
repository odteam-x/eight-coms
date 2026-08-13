-- ══════════════════════════════════════════════════════════════════════
--  0001 — Cierra las vías de escalada de privilegios en `profiles`
--  Idempotente. Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ ARREGLA (verificado contra la base real, no contra el .sql del repo):
--
--  1. `profiles_select` tenía USING (auth.uid() IS NOT NULL): CUALQUIER
--     usuario autenticado leía TODOS los perfiles. Las policies permisivas
--     se combinan con OR, así que esta anulaba por completo la restricción
--     por distrito de `profiles_read_secretario`.
--
--  2. `profiles_update_own` tenía WITH CHECK NULL. En PostgreSQL, si una
--     policy UPDATE no define WITH CHECK, se usa su USING como WITH CHECK.
--     Su USING era (auth.uid() = id OR is_admin()), que al combinarse con OR
--     con el WITH CHECK de `profiles_update` ANULABA la guarda `es_admin =
--     false`. Es decir: cualquier miembro podía hacerse ADMIN, no solo
--     secretario.
--
--  3. Ni tipo_miembro, ni distrito, ni rol_id estaban protegidos en ninguna
--     policy.
--
--  4. Había 25 filas en auth.users y solo 22 en profiles. Un usuario sin fila
--     en profiles activa el fallback de auth.js, que confía en
--     user_metadata — controlado por el propio usuario.
--
--  Cambios de esquema: añade profiles.aprobado.
--  Backfill: los 22 perfiles existentes quedan aprobados; los huérfanos de
--  auth.users se crean como miembro no aprobado.
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. Columna `aprobado` + backfill de una sola vez ──────────────────
--  El backfill va DENTRO del IF NOT existia: si se ejecutara suelto, cada
--  re-ejecución de la migración volvería a aprobar a los usuarios que el
--  admin hubiera dejado en pendiente a propósito.
DO $$
DECLARE existia BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'profiles'
       AND column_name  = 'aprobado'
  ) INTO existia;

  IF NOT existia THEN
    ALTER TABLE public.profiles
      ADD COLUMN aprobado BOOLEAN NOT NULL DEFAULT false;

    -- Todo perfil que ya existe es legítimo (gestión 2026-2027 en uso).
    UPDATE public.profiles SET aprobado = true;
  END IF;
END $$;


-- ── 2. Alta automática de perfil al crear el usuario ──────────────────
--  Sustituye al upsert del cliente en API.register(). Motivos:
--   · Con "Confirm email" activo, en signUp todavía no hay sesión, así que
--     auth.uid() es NULL y el upsert del cliente falla en silencio → usuario
--     sin perfil → fallback de auth.js → user_metadata como fuente de verdad.
--   · Los valores privilegiados se fijan aquí, en el servidor. El cliente no
--     puede influir en tipo_miembro, es_admin, distrito, rol_id ni aprobado.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre, tipo_miembro, es_admin, distrito, rol_id, aprobado)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data ->> 'nombre'), ''), SPLIT_PART(NEW.email, '@', 1)),
    'miembro',   -- nunca 'secretario', venga lo que venga en el metadata
    false,
    NULL,
    NULL,
    false        -- requiere aprobación explícita del admin
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill de los usuarios de auth.users que no tienen perfil.
-- Quedan SIN aprobar a propósito: hay que revisarlos a mano en el panel.
INSERT INTO public.profiles (id, email, nombre, tipo_miembro, es_admin, aprobado)
SELECT u.id,
       COALESCE(u.email, ''),
       COALESCE(NULLIF(TRIM(u.raw_user_meta_data ->> 'nombre'), ''), SPLIT_PART(COALESCE(u.email,'usuario@'), '@', 1)),
       'miembro',
       false,
       false
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
 WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- ── 3. Congelar los campos privilegiados ──────────────────────────────
--  Un trigger BEFORE UPDATE, no un WITH CHECK: el trigger ve OLD y NEW
--  directamente, mientras que WITH CHECK solo ve la fila nueva y obligaría
--  a releer la vieja desde una función, que es más frágil.
--
--  auth.uid() IS NULL → ejecución desde el SQL Editor o service_role, donde
--  el admin de base de datos debe poder corregir datos a mano.
CREATE OR REPLACE FUNCTION public.profiles_bloquear_campos_privilegiados()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.es_admin     IS DISTINCT FROM OLD.es_admin
  OR NEW.tipo_miembro IS DISTINCT FROM OLD.tipo_miembro
  OR NEW.distrito     IS DISTINCT FROM OLD.distrito
  OR NEW.rol_id       IS DISTINCT FROM OLD.rol_id
  OR NEW.aprobado     IS DISTINCT FROM OLD.aprobado
  OR NEW.id           IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'No puedes modificar rol, distrito, tipo de miembro ni estado de aprobacion.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_bloquear_privilegios ON public.profiles;
CREATE TRIGGER profiles_bloquear_privilegios
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_bloquear_campos_privilegiados();


-- ── 4. Policies limpias ───────────────────────────────────────────────
--  Se eliminan las capas contradictorias acumuladas por aplicar
--  supabase-schema.sql, fix-rls-secretario.sql y fix-evaluaciones-visibilidad.sql
--  una encima de otra.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select"           ON public.profiles;  -- leía TODO
DROP POLICY IF EXISTS "profiles_update_own"       ON public.profiles;  -- anulaba es_admin
DROP POLICY IF EXISTS "profiles_insert_own"       ON public.profiles;  -- duplicada
DROP POLICY IF EXISTS "profiles_read"             ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_secretario"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin"     ON public.profiles;

CREATE POLICY "profiles_read"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_read_secretario"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.is_secretario()
    AND distrito IS NOT NULL
    AND distrito = public.get_my_distrito()
  );

-- El INSERT del cliente ya no se usa (lo hace on_auth_user_created), pero se
-- deja acotado por si alguna ruta lo necesita: solo la propia fila y sin
-- privilegios.
CREATE POLICY "profiles_insert"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND es_admin     = false
    AND tipo_miembro = 'miembro'
    AND aprobado     = false
    AND distrito IS NULL
    AND rol_id   IS NULL
  );

-- El congelado real de campos lo hace el trigger; el WITH CHECK es una
-- segunda barrera para es_admin.
CREATE POLICY "profiles_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (
    public.is_admin()
    OR (id = auth.uid() AND es_admin = false)
  );

CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin());


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Debe devolver exactamente 5 policies y ninguna con qual "auth.uid() IS NOT NULL":
--
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles'
--    ORDER BY policyname;
--
-- Debe devolver 0 filas (todos los de auth.users tienen perfil):
--
--   SELECT u.id, u.email FROM auth.users u
--     LEFT JOIN public.profiles p ON p.id = u.id WHERE p.id IS NULL;
--
-- Debe devolver 22 aprobados y los huérfanos recién creados sin aprobar:
--
--   SELECT aprobado, count(*) FROM public.profiles GROUP BY aprobado;


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS profiles_bloquear_privilegios ON public.profiles;
-- DROP FUNCTION IF EXISTS public.profiles_bloquear_campos_privilegiados();
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();
--
-- DROP POLICY IF EXISTS "profiles_read"            ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_read_secretario" ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_insert"          ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_update"          ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_delete_admin"    ON public.profiles;
--
-- CREATE POLICY "profiles_read"   ON public.profiles FOR SELECT TO authenticated
--   USING (id = auth.uid() OR public.is_admin());
-- CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated
--   USING (id = auth.uid() OR public.is_admin())
--   WITH CHECK (public.is_admin() OR (id = auth.uid() AND es_admin = false));
-- CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated
--   WITH CHECK (id = auth.uid());
--
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS aprobado;
--
-- NOTA: el DOWN NO restaura `profiles_select` ni `profiles_update_own`.
-- Eran las dos vías de escalada; recrearlas volvería a abrir el agujero.
