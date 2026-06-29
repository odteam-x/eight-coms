-- ══════════════════════════════════════════════════════════════════════
--  EIGHT CREATORS LABs — Fix: Evaluaciones visibles para miembros y secretarios
--  Pegar TODO en: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Funciones auxiliares (SECURITY DEFINER = bypassan RLS) ──────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND es_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_secretario()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND tipo_miembro = 'secretario'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_distrito()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT distrito FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_district_member_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id
  FROM profiles p
  JOIN profiles sec ON sec.id = auth.uid()
  WHERE p.distrito = sec.distrito
    AND sec.tipo_miembro = 'secretario'
    AND sec.distrito IS NOT NULL;
$$;


-- ── 2. PROFILES — lectura propia, admin ve todo, secretario ve distrito ──

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_read"             ON profiles;
DROP POLICY IF EXISTS "profiles_read_secretario"  ON profiles;
DROP POLICY IF EXISTS "profiles_update"           ON profiles;
DROP POLICY IF EXISTS "profiles_insert"           ON profiles;

CREATE POLICY "profiles_read"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "profiles_read_secretario"
  ON profiles FOR SELECT TO authenticated
  USING (
    is_secretario()
    AND distrito IS NOT NULL
    AND distrito = get_my_distrito()
  );

CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_admin())
  WITH CHECK (
    is_admin()
    OR (id = auth.uid() AND es_admin = false)
  );

CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());


-- ── 3. EVALUACIONES — la parte clave ──────────────────────────────────

ALTER TABLE evaluaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evaluaciones_admin"               ON evaluaciones;
DROP POLICY IF EXISTS "evaluaciones_read_own_published"  ON evaluaciones;
DROP POLICY IF EXISTS "evaluaciones_read_secretario"     ON evaluaciones;

-- Admin: acceso total
CREATE POLICY "evaluaciones_admin"
  ON evaluaciones FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Miembro: lee SU evaluación publicada
CREATE POLICY "evaluaciones_read_own_published"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    evaluado_id = auth.uid()
    AND estado = 'publicado'
  );

-- Secretario: lee evaluaciones PUBLICADAS de su distrito
CREATE POLICY "evaluaciones_read_secretario"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    is_secretario()
    AND estado = 'publicado'
    AND evaluado_id IN (SELECT get_district_member_ids())
  );


-- ── 4. PERIODOS_EVALUACION — todos pueden leer ──────────────────────────

ALTER TABLE periodos_evaluacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "periodos_read"        ON periodos_evaluacion;
DROP POLICY IF EXISTS "periodos_admin_write" ON periodos_evaluacion;

CREATE POLICY "periodos_read"
  ON periodos_evaluacion FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "periodos_admin_write"
  ON periodos_evaluacion FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 5. EVALUACIONES_DISTRITO ──────────────────────────────────────────

ALTER TABLE IF EXISTS evaluaciones_distrito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eval_dist_admin" ON evaluaciones_distrito;
DROP POLICY IF EXISTS "eval_dist_read"  ON evaluaciones_distrito;

CREATE POLICY "eval_dist_admin"
  ON evaluaciones_distrito FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "eval_dist_read"
  ON evaluaciones_distrito FOR SELECT TO authenticated
  USING (estado = 'publicado' OR is_admin());


-- ── 6. CONFIG — todos pueden leer ──────────────────────────────────────

ALTER TABLE config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "config_read"        ON config;
DROP POLICY IF EXISTS "config_admin_write" ON config;

CREATE POLICY "config_read"
  ON config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "config_admin_write"
  ON config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 7. CRITERIOS, RUBRICA, CALENDARIO — todos pueden leer ──────────────

ALTER TABLE criterios ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrica   ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "criterios_read"        ON criterios;
DROP POLICY IF EXISTS "criterios_admin_write" ON criterios;
CREATE POLICY "criterios_read"
  ON criterios FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "criterios_admin_write"
  ON criterios FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "rubrica_read"        ON rubrica;
DROP POLICY IF EXISTS "rubrica_admin_write" ON rubrica;
CREATE POLICY "rubrica_read"
  ON rubrica FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "rubrica_admin_write"
  ON rubrica FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "calendario_read"        ON calendario;
DROP POLICY IF EXISTS "calendario_admin_write" ON calendario;
CREATE POLICY "calendario_read"
  ON calendario FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "calendario_admin_write"
  ON calendario FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 8. ROLES — anon + authenticated ───────────────────────────────────

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_anon_read"   ON roles;
DROP POLICY IF EXISTS "roles_auth_read"   ON roles;
DROP POLICY IF EXISTS "roles_admin_write" ON roles;

CREATE POLICY "roles_anon_read"
  ON roles FOR SELECT TO anon
  USING (activo = true);

CREATE POLICY "roles_auth_read"
  ON roles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "roles_admin_write"
  ON roles FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 9. TRABAJOS_ENTREGADOS ────────────────────────────────────────────

ALTER TABLE IF EXISTS trabajos_entregados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trabajos_read_own"  ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_write_own" ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_admin"     ON trabajos_entregados;

CREATE POLICY "trabajos_read_own"
  ON trabajos_entregados FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "trabajos_write_own"
  ON trabajos_entregados FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "trabajos_admin"
  ON trabajos_entregados FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 10. DISTRITOS ─────────────────────────────────────────────────────

ALTER TABLE IF EXISTS distritos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "distritos_read"  ON distritos;
DROP POLICY IF EXISTS "distritos_admin" ON distritos;

CREATE POLICY "distritos_read"
  ON distritos FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "distritos_admin"
  ON distritos FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Ejecuta esto para confirmar que las policies se crearon correctamente:
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','evaluaciones','evaluaciones_distrito',
                     'periodos_evaluacion','config','criterios','rubrica',
                     'calendario','roles','trabajos_entregados','distritos')
ORDER BY tablename, policyname;
