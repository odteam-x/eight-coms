-- ══════════════════════════════════════════════════════════════════════
--  EIGHT CREATORS LABs — Schema Supabase completo
--  CELIDER 08 · Portal de Evaluación
--
--  Instrucciones:
--  ─────────────
--  1. Abre Supabase Dashboard → SQL Editor → New query
--  2. Pega TODO este archivo y haz clic en "Run"
--  3. El script usa IF NOT EXISTS / ON CONFLICT / DROP IF EXISTS
--     → es IDEMPOTENTE: puedes ejecutarlo varias veces sin romper nada
--
--  Tablas creadas (en orden de dependencia):
--    1.  roles                    – tipos de rol de los creators
--    2.  profiles                 – usuarios del portal
--    3.  distritos                – 08-01 … 08-10 + EXT
--    4.  periodos_evaluacion      – PE1, PE2, PE3, PE4 …
--    5.  criterios                – criterios de evaluación individual
--    6.  evaluaciones             – evaluaciones individuales de miembros
--    7.  evaluaciones_distrito    – evaluaciones CGO/CCT/COM/CEE por distrito
--    8.  rubrica                  – rúbrica descriptiva por criterio
--    9.  calendario               – cronograma de actividades
--   10.  config                   – configuración global (clave-valor)
--   11.  periodo_participantes    – control de activación por PE
--   12.  credenciales             – referencia interna (solo admin)
--   13.  trabajos_entregados      – entregas de los creators
-- ══════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════
--  FUNCIONES AUXILIARES
--  Deben crearse ANTES que las policies que las invocan.
-- ══════════════════════════════════════════════════════════════════════

-- touch_updated_at: actualiza updated_at en cualquier tabla que lo use
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- is_admin: lee profiles sin pasar por RLS (SECURITY DEFINER)
--   Evita la recursión infinita que ocurriría si la policy de profiles
--   llamara a una función que a su vez leyera profiles con RLS activo.
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

-- is_secretario: igual patrón que is_admin()
CREATE OR REPLACE FUNCTION public.is_secretario()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tipo_miembro = 'secretario'
  );
$$;

-- get_my_distrito: devuelve el distrito del usuario en sesión
CREATE OR REPLACE FUNCTION public.get_my_distrito()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT distrito FROM profiles WHERE id = auth.uid();
$$;

-- get_district_member_ids: IDs de todos los miembros del distrito del secretario.
--   Usado en la policy de evaluaciones para que el secretario pueda leerlas.
CREATE OR REPLACE FUNCTION public.get_district_member_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id
  FROM   profiles p
  JOIN   profiles sec ON sec.id = auth.uid()
  WHERE  p.distrito   = sec.distrito
    AND  sec.tipo_miembro = 'secretario'
    AND  sec.distrito IS NOT NULL;
$$;


-- ══════════════════════════════════════════════════════════════════════
--  1. ROLES
--     Gestionable desde el panel admin.
--     El dropdown de registro lee esta tabla.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS roles (
  id         BIGSERIAL    PRIMARY KEY,
  nombre     TEXT         NOT NULL UNIQUE,
  activo     BOOLEAN      NOT NULL DEFAULT true,
  orden      SMALLINT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO roles (nombre, activo, orden) VALUES
  ('Filmmaker',       true, 0),
  ('Maquetación',     true, 1),
  ('Ideas Creativas', true, 2),
  ('P-CLIT',          true, 3),
  ('Motion Editor',   true, 4),
  ('X DEFINIR',       true, 5)
ON CONFLICT (nombre) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  2. PROFILES
--     id = mismo UUID que auth.users.
--     NUNCA se almacena contraseña aquí.
--     tipo_miembro: 'miembro' | 'secretario'
--     distrito:     '08-01' … '08-10' | 'EXT' | NULL
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre       TEXT         NOT NULL DEFAULT '',
  email        TEXT         NOT NULL DEFAULT '',
  rol_id       BIGINT       REFERENCES roles(id) ON DELETE SET NULL,
  es_admin     BOOLEAN      NOT NULL DEFAULT false,
  tipo_miembro TEXT         NOT NULL DEFAULT 'miembro'
                            CHECK (tipo_miembro IN ('miembro', 'secretario')),
  distrito     TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- Trigger: crear profile automáticamente al registrar un usuario en Supabase Auth.
-- SECURITY DEFINER → bypassa RLS → puede escribir aunque el usuario no tenga sesión.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre, tipo_miembro, distrito)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(COALESCE(NEW.email,''), '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'tipo_miembro', 'miembro'),
    NEW.raw_user_meta_data->>'distrito'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════════════════════════════
--  3. DISTRITOS
--     Catálogo de distritos del distrito 8 de CELIDER.
--     '08-01' … '08-10' + 'EXT' (Invitado Externo).
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS distritos (
  id     TEXT     PRIMARY KEY,      -- '08-01', 'EXT', etc.
  nombre TEXT     NOT NULL,
  activo BOOLEAN  NOT NULL DEFAULT true
);

INSERT INTO distritos (id, nombre, activo) VALUES
  ('08-01', 'Distrito 08-01',  true),
  ('08-02', 'Distrito 08-02',  true),
  ('08-03', 'Distrito 08-03',  true),
  ('08-04', 'Distrito 08-04',  true),
  ('08-05', 'Distrito 08-05',  true),
  ('08-06', 'Distrito 08-06',  true),
  ('08-07', 'Distrito 08-07',  true),
  ('08-08', 'Distrito 08-08',  true),
  ('08-09', 'Distrito 08-09',  true),
  ('08-10', 'Distrito 08-10',  true),
  ('EXT',   'Invitado Externo', true)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  4. PERIODOS_EVALUACION
--     Cantidad dinámica. Admin los crea y elimina desde el panel.
--     nombre es UNIQUE: PE1, PE2, PE3, PE4 …
--     activo: solo UN período puede estar activo (lo gestiona el admin).
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS periodos_evaluacion (
  id          BIGSERIAL    PRIMARY KEY,
  nombre      TEXT         NOT NULL UNIQUE,   -- 'PE1', 'PE2', …
  descripcion TEXT         NOT NULL DEFAULT '',
  activo      BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO periodos_evaluacion (nombre, descripcion, activo) VALUES
  ('PE1', 'Primer Período de Evaluación',    false),
  ('PE2', 'Segundo Período de Evaluación',   false),
  ('PE3', 'Tercer Período de Evaluación',    false),
  ('PE4', 'Cuarto Período de Evaluación',    false)
ON CONFLICT (nombre) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  5. CRITERIOS
--     Criterios de evaluación INDIVIDUAL (miembro).
--     key: identificador corto usado en puntajes JSONB ('pla','rev'…).
--     max_valor: puntuación máxima por criterio (normalmente 4).
--     descripcion: texto explicativo visible en la rúbrica.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS criterios (
  id          BIGSERIAL  PRIMARY KEY,
  key         TEXT       NOT NULL UNIQUE,
  label       TEXT       NOT NULL,
  abbr        TEXT       NOT NULL,
  color       TEXT       NOT NULL DEFAULT '#888888',
  max_valor   SMALLINT   NOT NULL DEFAULT 4,
  orden       SMALLINT   NOT NULL DEFAULT 0,
  activo      BOOLEAN    NOT NULL DEFAULT true,
  descripcion TEXT       NOT NULL DEFAULT ''
);

INSERT INTO criterios (key, label, abbr, color, max_valor, orden, descripcion) VALUES
  ('pla', 'Planificación',      'PLA', '#FF6064', 4, 0, ''),
  ('rev', 'Revisión',           'REV', '#38BDF8', 4, 1, ''),
  ('edi', 'Edición Creativa',   'EDI', '#2ECC71', 4, 2, ''),
  ('dis', 'Diseño Creativo',    'DIS', '#5B7FFF', 4, 3, ''),
  ('flu', 'Fluidez Oral',       'FLU', '#C084FC', 4, 4, ''),
  ('nar', 'Narrativa / Guión',  'NAR', '#F0C040', 4, 5, ''),
  ('eje', 'Ejecución en Redes', 'EJE', '#FB923C', 4, 6, '')
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  6. EVALUACIONES  (evaluaciones individuales de miembros)
--     Un solo registro por (periodo_id, evaluado_id) → UPSERT al guardar.
--     puntajes JSONB: { "pla": 3, "rev": 4, … }   (keys de criterios)
--     comentarios JSONB: { "pla": "Buen trabajo…", "general": "…" }
--     bono_ext: 0–2 puntos extra de excelencia.
--     estado: 'borrador' → solo admin lo ve;
--             'publicado' → miembro/secretario lo ven.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS evaluaciones (
  id           BIGSERIAL    PRIMARY KEY,
  periodo_id   BIGINT       NOT NULL REFERENCES periodos_evaluacion(id) ON DELETE RESTRICT,
  evaluado_id  UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evaluador_id UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  puntajes     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  bono_ext     NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (bono_ext BETWEEN 0 AND 2),
  comentarios  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  estado       TEXT         NOT NULL DEFAULT 'borrador'
                            CHECK (estado IN ('borrador', 'publicado')),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (periodo_id, evaluado_id)
);

DROP TRIGGER IF EXISTS evaluaciones_updated_at ON evaluaciones;
CREATE TRIGGER evaluaciones_updated_at
  BEFORE UPDATE ON evaluaciones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ══════════════════════════════════════════════════════════════════════
--  7. EVALUACIONES_DISTRITO
--     Evaluación colectiva del feed/distrito. Una por (periodo, distrito).
--     puntajes JSONB: { "cgo": 6, "cct": 5, "com": 7, "cee": 6 }
--       cgo = Competencia en Gestión y Organización   (0-7)
--       cct = Competencia Creativa y Técnica           (0-7)
--       com = Competencia Comunicativa                 (0-7)
--       cee = Competencia de Ejecución Estratégica     (0-7)
--     ig_stats JSONB: estadísticas de Instagram del período.
--       { "visualizaciones": 41937, "cuentas_alcanzadas": 9251,
--         "visitas_perfil": 1325, "seguidores_neto": 125,
--         "me_gusta": 2100, "comentarios": 89,
--         "guardados": 45, "compartidos": 20,
--         "top_publicacion": "Reel del 15 de junio" }
--     comentarios JSONB: { "cgo": "…", "cct": "…", "general": "…" }
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS evaluaciones_distrito (
  id           BIGSERIAL    PRIMARY KEY,
  periodo_id   BIGINT       NOT NULL REFERENCES periodos_evaluacion(id) ON DELETE RESTRICT,
  distrito_id  TEXT         NOT NULL REFERENCES distritos(id) ON DELETE RESTRICT,
  evaluador_id UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  ig_stats     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  puntajes     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  comentarios  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  estado       TEXT         NOT NULL DEFAULT 'borrador'
                            CHECK (estado IN ('borrador', 'publicado')),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (periodo_id, distrito_id)
);

DROP TRIGGER IF EXISTS eval_dist_updated_at ON evaluaciones_distrito;
CREATE TRIGGER eval_dist_updated_at
  BEFORE UPDATE ON evaluaciones_distrito
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ══════════════════════════════════════════════════════════════════════
--  8. RUBRICA
--     Descriptores de cada nivel por criterio.
--     criterio_id → criterios.id (FK).
--     criterio (texto) → label de respaldo si no hay FK.
--     nivel4 = Excelente, nivel3 = Bueno,
--     nivel2 = En Proceso, nivel1 = Bajo.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rubrica (
  id          BIGSERIAL  PRIMARY KEY,
  criterio_id BIGINT     REFERENCES criterios(id) ON DELETE CASCADE,
  criterio    TEXT       NOT NULL DEFAULT '',   -- label legible (respaldo)
  nivel4      TEXT       NOT NULL DEFAULT '',
  nivel3      TEXT       NOT NULL DEFAULT '',
  nivel2      TEXT       NOT NULL DEFAULT '',
  nivel1      TEXT       NOT NULL DEFAULT '',
  orden       SMALLINT   NOT NULL DEFAULT 0
);


-- ══════════════════════════════════════════════════════════════════════
--  9. CALENDARIO
--     Cronograma de actividades del portal.
--     color: rojo | verde | azul | amarillo (CSS var)
--     estado: Pendiente | En curso | Completado | Próximo
-- ══════════════════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════════════════
--  10. CONFIG
--      Configuración global clave-valor.
--      periodoActivo: nombre del PE activo, ej. 'PE1'.
--      sitioNombre:   nombre del portal mostrado en la UI.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

INSERT INTO config (clave, valor) VALUES
  ('sitioNombre',   'EIGHT CREATORS LABs'),
  ('periodoActivo', 'PE1')
ON CONFLICT (clave) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════
--  11. PERIODO_PARTICIPANTES
--      Control de qué usuarios participan en cada PE.
--      activo = false → el miembro aparece como "inactivo" en ese PE.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS periodo_participantes (
  periodo_id BIGINT   NOT NULL REFERENCES periodos_evaluacion(id) ON DELETE CASCADE,
  user_id    UUID     NOT NULL REFERENCES profiles(id)            ON DELETE CASCADE,
  activo     BOOLEAN  NOT NULL DEFAULT true,
  PRIMARY KEY (periodo_id, user_id)
);


-- ══════════════════════════════════════════════════════════════════════
--  12. CREDENCIALES
--      Almacena la contraseña en texto visible para que el admin pueda
--      consultarla desde el panel sin ir a Supabase Auth.
--      Solo accesible para is_admin() por RLS.
--      NUNCA exponer con la anon key.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS credenciales (
  user_id    UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL,
  clave      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════════════════════
--  13. TRABAJOS_ENTREGADOS
--      Entregas de los creators (links, títulos, descripciones).
--      Un creator puede tener varios trabajos por período.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS trabajos_entregados (
  id             BIGSERIAL    PRIMARY KEY,
  user_id        UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  periodo_nombre TEXT         NOT NULL,     -- 'PE1', 'PE2', …
  titulo         TEXT         NOT NULL DEFAULT '',
  descripcion    TEXT         NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trabajos_updated_at ON trabajos_entregados;
CREATE TRIGGER trabajos_updated_at
  BEFORE UPDATE ON trabajos_entregados
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ══════════════════════════════════════════════════════════════════════
--  ÍNDICES
-- ══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_profiles_rol         ON profiles(rol_id);
CREATE INDEX IF NOT EXISTS idx_profiles_admin       ON profiles(es_admin);
CREATE INDEX IF NOT EXISTS idx_profiles_distrito    ON profiles(distrito);
CREATE INDEX IF NOT EXISTS idx_profiles_tipo        ON profiles(tipo_miembro);

CREATE INDEX IF NOT EXISTS idx_eval_periodo         ON evaluaciones(periodo_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluado        ON evaluaciones(evaluado_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluador       ON evaluaciones(evaluador_id);
CREATE INDEX IF NOT EXISTS idx_eval_estado          ON evaluaciones(estado);

CREATE INDEX IF NOT EXISTS idx_evaldist_periodo     ON evaluaciones_distrito(periodo_id);
CREATE INDEX IF NOT EXISTS idx_evaldist_distrito    ON evaluaciones_distrito(distrito_id);
CREATE INDEX IF NOT EXISTS idx_evaldist_estado      ON evaluaciones_distrito(estado);

CREATE INDEX IF NOT EXISTS idx_rubrica_criterio     ON rubrica(criterio_id);
CREATE INDEX IF NOT EXISTS idx_rubrica_orden        ON rubrica(orden);

CREATE INDEX IF NOT EXISTS idx_cal_numero           ON calendario(numero);

CREATE INDEX IF NOT EXISTS idx_trabajos_user        ON trabajos_entregados(user_id);
CREATE INDEX IF NOT EXISTS idx_trabajos_periodo     ON trabajos_entregados(periodo_nombre);

CREATE INDEX IF NOT EXISTS idx_pp_user              ON periodo_participantes(user_id);


-- ══════════════════════════════════════════════════════════════════════
--  RLS — ROW LEVEL SECURITY
--
--  Modelo de seguridad:
--  ┌─────────────────┬────────────────────────────────────────────────┐
--  │ Rol             │ Acceso                                          │
--  ├─────────────────┼────────────────────────────────────────────────┤
--  │ anon            │ Solo roles activos (para el formulario de login)│
--  │ miembro         │ Su propio perfil + datos publicados             │
--  │ secretario      │ Perfiles y evaluaciones de su distrito          │
--  │ admin (es_admin)│ Todo, sin restricciones                         │
--  └─────────────────┴────────────────────────────────────────────────┘
--
--  La anon key en el JS público es SEGURA porque:
--  - Sin sesión activa el rol PostgreSQL es "anon"
--  - Todas las policies relevantes exigen auth.uid() IS NOT NULL
--  - La service_role key (que bypassa RLS) NUNCA va al frontend
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE distritos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos_evaluacion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE criterios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluaciones_distrito ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrica              ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendario           ENABLE ROW LEVEL SECURITY;
ALTER TABLE config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodo_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credenciales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajos_entregados  ENABLE ROW LEVEL SECURITY;


-- ── ROLES ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "roles_anon_read"   ON roles;
DROP POLICY IF EXISTS "roles_auth_read"   ON roles;
DROP POLICY IF EXISTS "roles_admin_write" ON roles;

-- Anon: solo roles activos (formulario de registro no requiere sesión)
CREATE POLICY "roles_anon_read"
  ON roles FOR SELECT TO anon
  USING (activo = true);

-- Autenticados: todos los roles
CREATE POLICY "roles_auth_read"
  ON roles FOR SELECT TO authenticated
  USING (true);

-- Solo admin puede crear / editar / borrar roles
CREATE POLICY "roles_admin_write"
  ON roles FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── PROFILES ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_read"             ON profiles;
DROP POLICY IF EXISTS "profiles_read_secretario"  ON profiles;
DROP POLICY IF EXISTS "profiles_update"           ON profiles;
DROP POLICY IF EXISTS "profiles_delete"           ON profiles;
DROP POLICY IF EXISTS "profiles_insert"           ON profiles;

-- Lectura: propio perfil | admin ve todos | secretario ve su distrito
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

-- Actualización: usuario edita su propio perfil pero NO puede darse is_admin=true.
--               Admin puede editar cualquier perfil.
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_admin())
  WITH CHECK (
    is_admin()
    OR (id = auth.uid() AND es_admin = false)
  );

-- Solo admin borra perfiles
CREATE POLICY "profiles_delete"
  ON profiles FOR DELETE TO authenticated
  USING (is_admin());

-- El trigger handle_new_user() hace el INSERT (SECURITY DEFINER).
-- Esta policy es de seguridad adicional por si alguien intenta INSERT manual.
CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());


-- ── DISTRITOS ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "distritos_read"  ON distritos;
DROP POLICY IF EXISTS "distritos_admin" ON distritos;

CREATE POLICY "distritos_read"
  ON distritos FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "distritos_admin"
  ON distritos FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── PERIODOS_EVALUACION ───────────────────────────────────────────────
DROP POLICY IF EXISTS "periodos_read"        ON periodos_evaluacion;
DROP POLICY IF EXISTS "periodos_admin_write" ON periodos_evaluacion;

CREATE POLICY "periodos_read"
  ON periodos_evaluacion FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "periodos_admin_write"
  ON periodos_evaluacion FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CRITERIOS ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "criterios_read"        ON criterios;
DROP POLICY IF EXISTS "criterios_admin_write" ON criterios;

CREATE POLICY "criterios_read"
  ON criterios FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "criterios_admin_write"
  ON criterios FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── EVALUACIONES ──────────────────────────────────────────────────────
--  Admin:       acceso total (lectura + escritura de cualquier evaluación)
--  Secretario:  lee evaluaciones PUBLICADAS de su distrito
--  Miembro:     lee solo SU evaluación publicada
DROP POLICY IF EXISTS "evaluaciones_admin"               ON evaluaciones;
DROP POLICY IF EXISTS "evaluaciones_read_own_published"  ON evaluaciones;
DROP POLICY IF EXISTS "evaluaciones_read_secretario"     ON evaluaciones;

CREATE POLICY "evaluaciones_admin"
  ON evaluaciones FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "evaluaciones_read_own_published"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    NOT is_admin()
    AND evaluado_id = auth.uid()
    AND estado = 'publicado'
  );

CREATE POLICY "evaluaciones_read_secretario"
  ON evaluaciones FOR SELECT TO authenticated
  USING (
    NOT is_admin()
    AND is_secretario()
    AND estado = 'publicado'
    AND evaluado_id IN (SELECT get_district_member_ids())
  );


-- ── EVALUACIONES_DISTRITO ─────────────────────────────────────────────
--  Admin:  acceso total (lee borradores y publicados, puede editar)
--  Resto:  lee solo los PUBLICADOS (para el ranking del secretario)
DROP POLICY IF EXISTS "eval_dist_admin" ON evaluaciones_distrito;
DROP POLICY IF EXISTS "eval_dist_read"  ON evaluaciones_distrito;

CREATE POLICY "eval_dist_admin"
  ON evaluaciones_distrito FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "eval_dist_read"
  ON evaluaciones_distrito FOR SELECT TO authenticated
  USING (estado = 'publicado' OR is_admin());


-- ── RUBRICA ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rubrica_read"        ON rubrica;
DROP POLICY IF EXISTS "rubrica_admin_write" ON rubrica;

CREATE POLICY "rubrica_read"
  ON rubrica FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "rubrica_admin_write"
  ON rubrica FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CALENDARIO ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "calendario_read"        ON calendario;
DROP POLICY IF EXISTS "calendario_admin_write" ON calendario;

CREATE POLICY "calendario_read"
  ON calendario FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "calendario_admin_write"
  ON calendario FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CONFIG ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "config_read"        ON config;
DROP POLICY IF EXISTS "config_admin_write" ON config;

CREATE POLICY "config_read"
  ON config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "config_admin_write"
  ON config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── PERIODO_PARTICIPANTES ─────────────────────────────────────────────
DROP POLICY IF EXISTS "pp_read"  ON periodo_participantes;
DROP POLICY IF EXISTS "pp_admin" ON periodo_participantes;

CREATE POLICY "pp_read"
  ON periodo_participantes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pp_admin"
  ON periodo_participantes FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── CREDENCIALES ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cred_admin" ON credenciales;

CREATE POLICY "cred_admin"
  ON credenciales FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── TRABAJOS_ENTREGADOS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "trabajos_read_own" ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_admin"    ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_insert"   ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_update"   ON trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_delete"   ON trabajos_entregados;

CREATE POLICY "trabajos_read_own"
  ON trabajos_entregados FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "trabajos_insert"
  ON trabajos_entregados FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "trabajos_update"
  ON trabajos_entregados FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "trabajos_delete"
  ON trabajos_entregados FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "trabajos_admin"
  ON trabajos_entregados FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ══════════════════════════════════════════════════════════════════════
--  VERIFICACIÓN FINAL
--  Ejecuta esto después del script para confirmar el estado de las policies:
-- ══════════════════════════════════════════════════════════════════════
-- SELECT tablename, policyname, cmd, qual
-- FROM   pg_policies
-- WHERE  schemaname = 'public'
-- ORDER  BY tablename, policyname;
--
-- Para ver columnas de una tabla:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'profiles'
-- ORDER  BY ordinal_position;
