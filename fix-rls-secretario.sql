-- ══════════════════════════════════════════════════════════════════════
--  EIGHT CREATORS LABs — Fix RLS para Secretario + tablas faltantes
--  Pegar TODO en: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. Funciones auxiliares (SECURITY DEFINER = bypassan RLS) ──────────
--  Evitan la recursión infinita: leen profiles directamente sin pasar
--  por las policies de RLS.

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

-- Devuelve los IDs de todos los miembros del mismo distrito del usuario en sesión.
-- Usado en las policies de evaluaciones para que secretario pueda leer las de su distrito.
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


-- ── 2. profiles: secretarios pueden leer perfiles de su distrito ───────
--  La policy original solo permite id=auth.uid() OR is_admin().
--  Añadimos una segunda policy permisiva (en Supabase se hace OR entre permissive).

DROP POLICY IF EXISTS "profiles_read_secretario" ON profiles;
CREATE POLICY "profiles_read_secretario"
  ON profiles FOR SELECT TO authenticated
  USING (
    is_secretario()
    AND distrito IS NOT NULL
    AND distrito = get_my_distrito()
  );


-- ── 3. evaluaciones: secretarios leen evaluaciones publicadas de su distrito ──
DROP POLICY IF EXISTS "evaluaciones_read_secretario" ON evaluaciones;
CREATE POLICY "evaluaciones_read_secretario"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    NOT is_admin()
    AND is_secretario()
    AND estado = 'publicado'
    AND evaluado_id IN (SELECT get_district_member_ids())
  );


-- ── 4. evaluaciones_distrito: acceso completo ──────────────────────────
--  Esta tabla fue creada después del schema original, sin policies RLS.
--  Admin puede leer/escribir todo. Authenticated lee los publicados + los suyos.

ALTER TABLE IF EXISTS evaluaciones_distrito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eval_dist_admin"  ON evaluaciones_distrito;
DROP POLICY IF EXISTS "eval_dist_read"   ON evaluaciones_distrito;

CREATE POLICY "eval_dist_admin"
  ON evaluaciones_distrito FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Todos los autenticados pueden leer evaluaciones_distrito publicadas
-- (el ranking de secretario y admin lo necesita)
CREATE POLICY "eval_dist_read"
  ON evaluaciones_distrito FOR SELECT TO authenticated
  USING (estado = 'publicado' OR is_admin());


-- ── 5. distritos: readable por todos los autenticados ─────────────────
--  Esta tabla también fue creada después del schema original.

ALTER TABLE IF EXISTS distritos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "distritos_admin" ON distritos;
DROP POLICY IF EXISTS "distritos_read"  ON distritos;

CREATE POLICY "distritos_read"
  ON distritos FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "distritos_admin"
  ON distritos FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 6. periodo_participantes (si existe) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'periodo_participantes') THEN
    ALTER TABLE periodo_participantes ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "pp_read"  ON periodo_participantes;
DROP POLICY IF EXISTS "pp_admin" ON periodo_participantes;

CREATE POLICY "pp_read"
  ON periodo_participantes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pp_admin"
  ON periodo_participantes FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── 7. credenciales: solo admin ───────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credenciales') THEN
    ALTER TABLE credenciales ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "cred_admin" ON credenciales;
CREATE POLICY "cred_admin"
  ON credenciales FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── VERIFICACIÓN ───────────────────────────────────────────────────────
-- Ejecuta esto después para confirmar que las policies se crearon:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','evaluaciones','evaluaciones_distrito','distritos','periodo_participantes')
ORDER BY tablename, policyname;
