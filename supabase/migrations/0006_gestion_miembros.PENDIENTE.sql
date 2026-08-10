-- ══════════════════════════════════════════════════════════════════════
--  0006 — gestion_miembros (Fase 4B)   ⚠ NO APLICADA — PENDIENTE
-- ══════════════════════════════════════════════════════════════════════
--
--  ⚠ NO EJECUTAR TODAVÍA. Se aplica solo cuando esté verificado en
--  producción que las fases 3A/3B funcionan con sesión iniciada. El nombre
--  del archivo lleva .PENDIENTE a propósito para que no se cuele en una
--  ejecución por orden numérico.
--
--  QUÉ HACE
--  Mueve `tipo_miembro`, `distrito` y `rol_id` de `profiles` a una tabla
--  por gestión, para que alguien pueda ser miembro en una gestión y
--  secretario en otra sin reescribir su historial.
--
--  `profiles` queda solo con identidad: id, email, nombre, avatar_url,
--  es_admin, aprobado, created_at.
--
--  OJO CON LA MOTIVACIÓN
--  El brief decía que esto «resuelve de raíz la escalada de privilegios de
--  la Fase 1.2». Eso YA está resuelto y verificado por el trigger
--  profiles_bloquear_privilegios de la migración 0001. Esta migración
--  aporta flexibilidad multi-gestión, NO seguridad adicional.
--
--  ALCANCE MEDIDO (por eso va aparte)
--  Reescribe 5 funciones SECURITY DEFINER:
--    is_secretario, get_my_distrito, get_district_member_ids,
--    handle_new_user, profiles_bloquear_campos_privilegiados
--  y afecta a policies de profiles, evaluaciones, evaluaciones_distrito y
--  trabajos_entregados.
--
--  ⚠ REQUIERE CAMBIOS DE FRONTEND EN EL MISMO DESPLIEGUE
--  No se han escrito todavía, a propósito: dejarlos en el árbol sin aplicar
--  el SQL rompería la aplicación. Hay que hacerlos a la vez que esta
--  migración:
--    · auth.js  — getProfile() debe unir profiles con gestion_miembros de
--                 la gestión en curso para rellenar tipo_miembro/distrito/rol_id
--    · admin.js — la gestión de usuarios escribe en gestion_miembros, no en
--                 profiles (updateUserField, updateUserRol)
--    · api.js   — getAllUsers debe unir con gestion_miembros
--    · secretario.js — getMyDistrito() sale del perfil resuelto por gestión
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. Tabla de miembros por gestión ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gestion_miembros (
  gestion_id   BIGINT  NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  user_id      UUID    NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  rol_id       INTEGER REFERENCES public.roles(id) ON DELETE SET NULL,
  tipo_miembro TEXT    NOT NULL DEFAULT 'miembro'
                       CHECK (tipo_miembro IN ('miembro','secretario')),
  distrito     TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (gestion_id, user_id)
);

CREATE INDEX IF NOT EXISTS gestion_miembros_user_idx ON public.gestion_miembros (user_id);

ALTER TABLE public.gestion_miembros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_read_own" ON public.gestion_miembros;
CREATE POLICY "gm_read_own"
  ON public.gestion_miembros FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "gm_admin" ON public.gestion_miembros;
CREATE POLICY "gm_admin"
  ON public.gestion_miembros FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ── 2. Backfill desde profiles ────────────────────────────────────────
INSERT INTO public.gestion_miembros (gestion_id, user_id, rol_id, tipo_miembro, distrito, activo)
SELECT g.id, p.id, p.rol_id, p.tipo_miembro, p.distrito, true
  FROM public.profiles p
 CROSS JOIN (SELECT id FROM public.gestiones WHERE activa LIMIT 1) g
ON CONFLICT (gestion_id, user_id) DO NOTHING;


-- ── 3. Funciones reescritas ───────────────────────────────────────────
--  Todas resuelven contra la gestión ACTIVA. Un secretario de una gestión
--  archivada no debe conservar sus permisos en la gestión en curso.

CREATE OR REPLACE FUNCTION public.gestion_activa_id()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT id FROM gestiones WHERE activa LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.is_secretario()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM gestion_miembros gm
     WHERE gm.user_id = auth.uid()
       AND gm.gestion_id = public.gestion_activa_id()
       AND gm.tipo_miembro = 'secretario'
       AND gm.activo
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_distrito()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT gm.distrito FROM gestion_miembros gm
   WHERE gm.user_id = auth.uid() AND gm.gestion_id = public.gestion_activa_id();
$$;

CREATE OR REPLACE FUNCTION public.get_district_member_ids()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT m.user_id
    FROM gestion_miembros m
    JOIN gestion_miembros sec
      ON sec.user_id = auth.uid()
     AND sec.gestion_id = m.gestion_id
   WHERE m.gestion_id = public.gestion_activa_id()
     AND sec.tipo_miembro = 'secretario'
     AND sec.distrito IS NOT NULL
     AND m.distrito = sec.distrito;
$$;

-- El alta ya no fija rol ni distrito en profiles: eso vive en gestion_miembros
-- y lo asigna el admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre, es_admin, aprobado)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data ->> 'nombre'), ''), SPLIT_PART(NEW.email,'@',1)),
    false, false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- profiles ya no tiene los tres campos: el trigger solo congela es_admin,
-- aprobado e id.
CREATE OR REPLACE FUNCTION public.profiles_bloquear_campos_privilegiados()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF NEW.es_admin IS DISTINCT FROM OLD.es_admin
  OR NEW.aprobado IS DISTINCT FROM OLD.aprobado
  OR NEW.id       IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'No puedes modificar tu nivel de acceso.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


-- ── 4. Retirar las columnas de profiles ───────────────────────────────
--  ⚠ IRREVERSIBLE con datos. Ejecutar SOLO tras comprobar que el paso 2
--  copió todo y que el frontend actualizado ya está desplegado.
--
--  Comprobación previa — debe devolver 0:
--    SELECT count(*) FROM profiles p
--     WHERE NOT EXISTS (SELECT 1 FROM gestion_miembros gm
--                        WHERE gm.user_id = p.id
--                          AND gm.gestion_id = public.gestion_activa_id());
--
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS tipo_miembro;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS distrito;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS rol_id;


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Mismos recuentos que en profiles antes de migrar (3 admins, 9 secretarios):
--   SELECT tipo_miembro, count(*) FROM gestion_miembros
--    WHERE gestion_id = public.gestion_activa_id() GROUP BY 1;
--
-- Las funciones siguen respondiendo lo mismo para un secretario conocido:
--   SELECT public.is_secretario(), public.get_my_distrito();


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- Mientras NO se hayan ejecutado los DROP COLUMN del paso 4, basta con:
--   DROP TABLE IF EXISTS public.gestion_miembros CASCADE;
-- y restaurar las cinco funciones a su versión de la migración 0001.
-- Después de los DROP COLUMN, el DOWN exige recrear las columnas y volcar
-- los datos desde gestion_miembros de la gestión activa.
