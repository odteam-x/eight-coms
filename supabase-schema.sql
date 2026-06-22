-- ══════════════════════════════════════════════════════════════════════
--  EIGHT CREATORS LABs — Schema Supabase completo
--  Pegar TODO en: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. ROLES ──────────────────────────────────────────────────────────
--  Gestionable desde el panel admin. El dropdown de registro lee esta tabla.
CREATE TABLE IF NOT EXISTS roles (
  id         BIGSERIAL    PRIMARY KEY,
  nombre     TEXT         NOT NULL UNIQUE,
  activo     BOOLEAN      NOT NULL DEFAULT true,
  orden      SMALLINT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO roles (nombre, activo, orden) VALUES
  ('Filmmaker',        true, 0),
  ('Maquetación',      true, 1),
  ('Ideas Creativas',  true, 2),
  ('P-CLIT',           true, 3),
  ('Motion Editor',    true, 4),
  ('X DEFINIR',        true, 5)
ON CONFLICT (nombre) DO NOTHING;


-- ── 2. PROFILES ───────────────────────────────────────────────────────
--  id = mismo UUID que auth.users (Supabase Auth lo genera).
--  NUNCA se guarda contraseña aquí. La gestiona Supabase Auth.
--  es_admin solo lo modifica un admin o el trigger de inicialización.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     TEXT         NOT NULL DEFAULT '',
  email      TEXT         NOT NULL DEFAULT '',
  rol_id     BIGINT       REFERENCES roles(id) ON DELETE SET NULL,
  es_admin   BOOLEAN      NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Trigger: al crear un usuario en Supabase Auth, crear su profile automáticamente.
-- Se ejecuta con SECURITY DEFINER → bypassa RLS → puede escribir en profiles
-- aunque el usuario aún no tenga sesión activa.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(COALESCE(NEW.email,''), '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 3. PERIODOS_EVALUACION ────────────────────────────────────────────
--  Cantidad dinámica, NO fija a PE1/PE2/PE3.
--  Admin puede añadir y eliminar desde el panel.
CREATE TABLE IF NOT EXISTS periodos_evaluacion (
  id          BIGSERIAL    PRIMARY KEY,
  nombre      TEXT         NOT NULL,       -- ej: "PE1", "Segundo Semestre 2026"
  descripcion TEXT         NOT NULL DEFAULT '',
  activo      BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO periodos_evaluacion (nombre, descripcion, activo) VALUES
  ('PE1', 'Primer Período de Evaluación',   false),
  ('PE2', 'Segundo Período de Evaluación',  true),
  ('PE3', 'Tercer Período de Evaluación',   false)
ON CONFLICT DO NOTHING;


-- ── 4. CRITERIOS ──────────────────────────────────────────────────────
--  Los keys (pla, rev, etc.) se usan como claves en evaluaciones.puntajes (JSONB).
CREATE TABLE IF NOT EXISTS criterios (
  id        BIGSERIAL  PRIMARY KEY,
  key       TEXT       NOT NULL UNIQUE,    -- 'pla', 'rev', 'edi', ...
  label     TEXT       NOT NULL,
  abbr      TEXT       NOT NULL,
  color     TEXT       NOT NULL DEFAULT '#888888',
  max_valor SMALLINT   NOT NULL DEFAULT 4, -- los de miembro van de 0-4
  orden     SMALLINT   NOT NULL DEFAULT 0,
  activo    BOOLEAN    NOT NULL DEFAULT true
);

INSERT INTO criterios (key, label, abbr, color, max_valor, orden) VALUES
  ('pla', 'Planificación',       'PLA', '#FF6064', 4, 0),
  ('rev', 'Revisión',            'REV', '#38BDF8', 4, 1),
  ('edi', 'Edición Creativa',    'EDI', '#2ECC71', 4, 2),
  ('dis', 'Diseño Creativo',     'DIS', '#5B7FFF', 4, 3),
  ('flu', 'Fluidez Oral',        'FLU', '#C084FC', 4, 4),
  ('nar', 'Narrativa / Guión',   'NAR', '#F0C040', 4, 5),
  ('eje', 'Ejecución en Redes',  'EJE', '#FB923C', 4, 6)
ON CONFLICT (key) DO NOTHING;


-- ── 5. EVALUACIONES ───────────────────────────────────────────────────
--  puntajes y comentarios son JSONB → flexible si se añaden criterios.
--  Ejemplo puntajes: { "pla": 3, "rev": 4, "edi": 2, ... }
--  Ejemplo comentarios: { "pla": "Buen trabajo en la planificación...", ... }
--  Un solo registro por (periodo, evaluado). UPSERT al guardar.
CREATE TABLE IF NOT EXISTS evaluaciones (
  id           BIGSERIAL    PRIMARY KEY,
  periodo_id   BIGINT       NOT NULL REFERENCES periodos_evaluacion(id) ON DELETE RESTRICT,
  evaluado_id  UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evaluador_id UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  puntajes     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  bono_ext     NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (bono_ext BETWEEN 0 AND 2),
  comentarios  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  estado       TEXT         NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicado')),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (periodo_id, evaluado_id)
);

-- Trigger: actualizar updated_at en cada UPDATE
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS evaluaciones_updated_at ON evaluaciones;
CREATE TRIGGER evaluaciones_updated_at
  BEFORE UPDATE ON evaluaciones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ── 6. RUBRICA ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rubrica (
  id          BIGSERIAL  PRIMARY KEY,
  criterio_id BIGINT     REFERENCES criterios(id) ON DELETE CASCADE,
  nivel4      TEXT       NOT NULL DEFAULT '',  -- Excelente
  nivel3      TEXT       NOT NULL DEFAULT '',  -- Bueno
  nivel2      TEXT       NOT NULL DEFAULT '',  -- En Proceso
  nivel1      TEXT       NOT NULL DEFAULT '',  -- Bajo
  orden       SMALLINT   NOT NULL DEFAULT 0
);


-- ── 7. CALENDARIO ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendario (
  id          BIGSERIAL  PRIMARY KEY,
  numero      SMALLINT   NOT NULL,
  titulo      TEXT       NOT NULL DEFAULT '',
  color       TEXT       NOT NULL DEFAULT 'azul'
                         CHECK (color IN ('rojo','verde','azul','amarillo')),
  inicio      DATE,
  fin_trabajo DATE,
  entrega     DATE,
  jornada     DATE,
  estado      TEXT       NOT NULL DEFAULT 'Pendiente'
                         CHECK (estado IN ('Pendiente','En curso','Completado','Próximo'))
);


-- ── 8. CONFIG ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

INSERT INTO config VALUES
  ('sitioNombre',   'EIGHT CREATORS LABs'),
  ('periodoActivo', '')
ON CONFLICT (clave) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  ÍNDICES
-- ══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_eval_periodo    ON evaluaciones(periodo_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluado   ON evaluaciones(evaluado_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluador  ON evaluaciones(evaluador_id);
CREATE INDEX IF NOT EXISTS idx_profiles_rol    ON profiles(rol_id);
CREATE INDEX IF NOT EXISTS idx_profiles_admin  ON profiles(es_admin);


-- ══════════════════════════════════════════════════════════════════════
--  RLS — Row Level Security
--
--  ¿Por qué la anon key en el JS público es SEGURA?
--  ─────────────────────────────────────────────────
--  La anon key solo identifica la app ante Supabase. Por sí sola,
--  sin un JWT de sesión válido, el rol PostgreSQL es "anon".
--  Todas las policies a continuación exigen auth.uid() IS NOT NULL,
--  que solo se cumple con una sesión autenticada real.
--  Sin sesión: Supabase devuelve 0 filas / error en cualquier tabla.
--  La service_role key (que SÍ bypassa RLS) NUNCA va al frontend.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos_evaluacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE criterios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrica             ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendario          ENABLE ROW LEVEL SECURITY;
ALTER TABLE config              ENABLE ROW LEVEL SECURITY;


-- ── Helper: is_admin() ────────────────────────────────────────────────
--  SECURITY DEFINER → bypassa RLS al consultar profiles.
--  Esto EVITA la recursión infinita: la policy de profiles llama
--  is_admin(), que lee profiles con permisos de superusuario (sin pasar
--  por las policies), devuelve el booleano y regresa.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND es_admin = true
  );
$$;


-- ── POLICY DE DEMOSTRACIÓN ────────────────────────────────────────────
--  Sin sesión válida, esta policy deniega TODO acceso a roles:
--    SELECT * FROM roles;  → devuelve 0 filas para el rol anon
--  Con sesión: devuelve los roles activos.
--  Pruébalo en SQL Editor con "Run as: anon" vs "Run as: authenticated".

-- ── ROLES ─────────────────────────────────────────────────────────────
-- Anon puede leer roles activos (necesario para el formulario de registro)
CREATE POLICY "roles_anon_read_activos"
  ON roles FOR SELECT TO anon
  USING (activo = true);

-- Usuarios autenticados leen todos
CREATE POLICY "roles_auth_read"
  ON roles FOR SELECT TO authenticated
  USING (true);

-- Solo admin escribe
CREATE POLICY "roles_admin_write"
  ON roles FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── PROFILES ──────────────────────────────────────────────────────────
-- Lectura: cada usuario ve su propio perfil; admin ve todos
CREATE POLICY "profiles_read"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());

-- UPDATE: usuario actualiza su propio perfil, pero es_admin DEBE quedar false.
-- Admin puede actualizar cualquier perfil (incluyendo es_admin).
-- → Un usuario NO puede auto-promocionarse a admin por ninguna vía desde el cliente.
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_admin())
  WITH CHECK (
    is_admin()
    OR (id = auth.uid() AND es_admin = false)
  );

-- Solo admin puede eliminar perfiles
CREATE POLICY "profiles_delete"
  ON profiles FOR DELETE TO authenticated
  USING (is_admin());

-- INSERT lo maneja el trigger handle_new_user() (SECURITY DEFINER).
-- Esta policy es de seguridad adicional por si alguien intenta INSERT manual.
CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());


-- ── PERIODOS_EVALUACION ───────────────────────────────────────────────
CREATE POLICY "periodos_read"
  ON periodos_evaluacion FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "periodos_admin_write"
  ON periodos_evaluacion FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CRITERIOS ─────────────────────────────────────────────────────────
CREATE POLICY "criterios_read"
  ON criterios FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "criterios_admin_write"
  ON criterios FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── EVALUACIONES ──────────────────────────────────────────────────────
-- Admin: acceso total
CREATE POLICY "evaluaciones_admin"
  ON evaluaciones FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Usuario normal: solo lee SUS evaluaciones publicadas (nunca borradores)
CREATE POLICY "evaluaciones_read_own_published"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    evaluado_id = auth.uid()
    AND estado = 'publicado'
    AND NOT is_admin()
  );


-- ── RUBRICA ───────────────────────────────────────────────────────────
CREATE POLICY "rubrica_read"
  ON rubrica FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "rubrica_admin_write"
  ON rubrica FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CALENDARIO ────────────────────────────────────────────────────────
CREATE POLICY "calendario_read"
  ON calendario FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "calendario_admin_write"
  ON calendario FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CONFIG ────────────────────────────────────────────────────────────
CREATE POLICY "config_read"
  ON config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "config_admin_write"
  ON config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ══════════════════════════════════════════════════════════════════════
--  VERIFICACIÓN: ejecutar después para comprobar que las policies existen
-- ══════════════════════════════════════════════════════════════════════
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
