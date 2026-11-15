-- ══════════════════════════════════════════════════════════════════════
--  0071 — Recursos: el «Banco de imágenes» pasa a ser un banco de recursos de cualquier tipo
-- ══════════════════════════════════════════════════════════════════════
--
--  PEDIDO DEL DUEÑO. «El apartado de banco pasará a ser recursos, para que no solo sean imágenes o enlaces, sino para que se
--  puedan agregar otros tipos de recursos como identidad gráfica de n eventos, imágenes, etc.»
--
--  QUÉ ES UN RECURSO. Una ficha con TÍTULO, TIPO, EVENTO (opcional; agrupa «la identidad gráfica del evento X», sus fotos…),
--  CATEGORÍA y ETIQUETAS (opcionales), DESCRIPCIÓN y una o varias PARTES (`partes`, JSONB validado en la base):
--      {t:'enlace', e:'Carpeta de logos', v:'https://…'}   ← un enlace http(s) (Drive, Dropbox, YouTube, Canva, Figma…)
--      {t:'color',  e:'Azul institucional', v:'#1A4FA0'}    ← un color en hexadecimal (paleta de la identidad gráfica)
--      {t:'fuente', e:'Títulos', v:'Montserrat Bold'}      ← el nombre de una tipografía
--  TIPOS (CHECK): imagen, video, enlace, identidad (logos, paletas, tipografías, plantillas de un evento), documento,
--  plantilla, audio, otro.
--
--  DECISIÓN SOBRE ARCHIVOS: NO se suben archivos. Se mantiene «solo enlaces» (como el banco de 0058) y la identidad gráfica se
--  guarda como colección de enlaces + paleta de colores + tipografías como TEXTO. Motivos: (1) Storage de pago y sin cuotas por
--  persona ni antivirus; un logo en SVG/PDF puede llevar scripts y un archivo suelto no se puede retirar de las copias que ya se
--  descargaron; (2) un bucket nuevo con políticas por carpeta no se puede verificar contra la base viva desde las sesiones de
--  desarrollo (el conector es de solo lectura) y fallaría en producción sin que las pruebas lo vieran; (3) los equipos ya
--  trabajan con Drive/Canva, y un enlace conserva el permiso de quien lo comparte (si lo retira, deja de verse). Si más
--  adelante se quiere subir archivos, el modelo ya lo admite añadiendo un tipo de parte {t:'archivo'} y un bucket privado con
--  URL firmada, sin migrar los datos.
--
--  QUIÉN PUEDE QUÉ (igual que el banco; lo impone la base).
--    · LEER: toda persona autenticada con el acceso aprobado.
--    · AÑADIR: cualquier persona aprobada, en una gestión no archivada. `creado_por`, `gestion_id`, `rol_id` y `distrito` los
--      fija el servidor (el cliente no los elige).
--    · EDITAR / BORRAR: quien lo subió o la administración, en una gestión no archivada.
--
--  PARIDAD. Cada fila de `banco_imagenes` se copia a `recursos` con tipo «imagen», su enlace como única parte y su fecha, autor,
--  rol y distrito originales. `recursos.banco_id` recuerda el origen: volver a ejecutar esta migración (por ejemplo tras el
--  despliegue, por si alguien añadió un enlace al banco antiguo entre medias) copia solo lo que falte. `banco_imagenes` NO se
--  toca ni se borra (es la reversa y mantiene vivo el portal anterior hasta el despliegue); el portal nuevo ya no la lee.
--
--  Requiere 0013 (gestion_id_escribible). Aplicación manual en el SQL Editor. Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- Acceso aprobado (una persona pendiente no ve ni escribe nada). Misma definición que 0058: se repite para no depender de ella.
CREATE OR REPLACE FUNCTION public.es_persona_aprobada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND aprobado IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.es_persona_aprobada() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_persona_aprobada() TO authenticated;

-- Valida el JSON de partes: 1 a 20; cada una {t, e?, v} con t ∈ enlace|color|fuente.
CREATE OR REPLACE FUNCTION public.recursos_partes_validas(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) BETWEEN 1 AND 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) x
      WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
         OR COALESCE(x->>'t', '') NOT IN ('enlace', 'color', 'fuente')
         OR jsonb_typeof(x->'v') IS DISTINCT FROM 'string'
         OR length(COALESCE(x->>'e', '')) > 60
         OR (x->>'t' = 'enlace' AND NOT (length(x->>'v') <= 1000 AND x->>'v' ~* '^https?://[^[:space:]]+$'))
         OR (x->>'t' = 'color'  AND x->>'v' !~ '^#[0-9a-fA-F]{6}$')
         OR (x->>'t' = 'fuente' AND length(btrim(x->>'v')) NOT BETWEEN 1 AND 80)
    );
$$;

CREATE TABLE IF NOT EXISTS public.recursos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id   BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  titulo       TEXT   NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 120),
  tipo         TEXT   NOT NULL DEFAULT 'imagen' CHECK (tipo IN ('imagen', 'video', 'enlace', 'identidad', 'documento', 'plantilla', 'audio', 'otro')),
  descripcion  TEXT   NOT NULL DEFAULT '' CHECK (length(descripcion) <= 600),
  evento       TEXT   NOT NULL DEFAULT '' CHECK (length(evento) <= 120),
  categoria    TEXT   NOT NULL DEFAULT '' CHECK (length(categoria) <= 60),
  etiquetas    TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(etiquetas) <= 8 AND length(array_to_string(etiquetas, ' ')) <= 280),
  partes       JSONB  NOT NULL CHECK (public.recursos_partes_validas(partes)),
  rol_id       INTEGER REFERENCES public.roles(id) ON DELETE SET NULL,
  distrito     TEXT,
  creado_por   UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  banco_id     BIGINT UNIQUE,                       -- fila de banco_imagenes de la que viene (NULL si nació como recurso)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recursos_gestion_idx ON public.recursos (gestion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recursos_rol_idx     ON public.recursos (rol_id);
CREATE INDEX IF NOT EXISTS recursos_tipo_idx    ON public.recursos (gestion_id, tipo);

-- El servidor decide quién es el autor, la gestión, el rol y el distrito; ordena etiquetas y textos.
CREATE OR REPLACE FUNCTION public.recursos_fijar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesión.'; END IF;
    NEW.creado_por := auth.uid();
    IF NEW.gestion_id IS NULL THEN SELECT id INTO NEW.gestion_id FROM gestiones WHERE activa ORDER BY id DESC LIMIT 1; END IF;
    SELECT p.rol_id, p.distrito INTO NEW.rol_id, NEW.distrito FROM profiles p WHERE p.id = auth.uid();
    NEW.banco_id := NULL;                                -- el origen solo lo pone la copia de la migración
  ELSE
    NEW.creado_por := OLD.creado_por; NEW.gestion_id := OLD.gestion_id; NEW.rol_id := OLD.rol_id; NEW.distrito := OLD.distrito;
    NEW.banco_id := OLD.banco_id;
    NEW.updated_at := now();
  END IF;
  NEW.titulo := btrim(NEW.titulo); NEW.evento := btrim(NEW.evento); NEW.categoria := btrim(NEW.categoria);
  -- etiquetas: sin vacías ni repetidas (sin distinguir mayúsculas), cada una de 30 como máximo
  NEW.etiquetas := COALESCE((SELECT array_agg(t ORDER BY o) FROM (
      SELECT min(left(btrim(e), 30)) AS t, min(n) AS o FROM unnest(NEW.etiquetas) WITH ORDINALITY AS u(e, n)
      WHERE btrim(e) <> '' GROUP BY lower(left(btrim(e), 30))) z), '{}');
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.recursos_fijar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS recursos_fijar ON public.recursos;
CREATE TRIGGER recursos_fijar BEFORE INSERT OR UPDATE ON public.recursos FOR EACH ROW EXECUTE FUNCTION public.recursos_fijar();

ALTER TABLE public.recursos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recursos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recursos TO authenticated;

DROP POLICY IF EXISTS recursos_leer ON public.recursos;
CREATE POLICY recursos_leer ON public.recursos FOR SELECT TO authenticated USING (public.es_persona_aprobada());

DROP POLICY IF EXISTS recursos_insertar ON public.recursos;
CREATE POLICY recursos_insertar ON public.recursos FOR INSERT TO authenticated
  WITH CHECK (public.es_persona_aprobada() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS recursos_editar ON public.recursos;
CREATE POLICY recursos_editar ON public.recursos FOR UPDATE TO authenticated
  USING (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id))
  WITH CHECK (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS recursos_borrar ON public.recursos;
CREATE POLICY recursos_borrar ON public.recursos FOR DELETE TO authenticated
  USING (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id));

-- ── Paridad: copiar el banco de imágenes (solo lo que aún no se copió) ───────────────────────────────────────────────────
-- Se apaga el disparador solo durante la copia: en el SQL Editor no hay sesión (auth.uid() es NULL) y el original conserva su
-- autor, rol, distrito y fechas.
DO $$
DECLARE copiadas INT := 0;
BEGIN
  IF to_regclass('public.banco_imagenes') IS NULL THEN
    RAISE NOTICE 'No existe banco_imagenes (0058 no aplicada): no hay nada que copiar.';
    RETURN;
  END IF;
  ALTER TABLE public.recursos DISABLE TRIGGER recursos_fijar;
  INSERT INTO public.recursos (gestion_id, titulo, tipo, descripcion, evento, partes, rol_id, distrito, creado_por, banco_id, created_at, updated_at)
  SELECT b.gestion_id, b.titulo, 'imagen', b.descripcion, b.evento,
         jsonb_build_array(jsonb_build_object('t', 'enlace', 'e', '', 'v', b.enlace)),
         b.rol_id, b.distrito, b.creado_por, b.id, b.created_at, b.updated_at
    FROM public.banco_imagenes b
   WHERE NOT EXISTS (SELECT 1 FROM public.recursos r WHERE r.banco_id = b.id);
  GET DIAGNOSTICS copiadas = ROW_COUNT;
  ALTER TABLE public.recursos ENABLE TRIGGER recursos_fijar;
  RAISE NOTICE 'Recursos: % fila(s) copiadas desde banco_imagenes.', copiadas;
END $$;

-- ── Tiempo real (misma regla que 0064: RLS activa, clave primaria y nada para anon) ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;      -- en Supabase ya existe; esto solo cubre un entorno local
  END IF;
  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publica TODAS las tablas: no hay nada que añadir.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'recursos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recursos;
  END IF;
END $$;

COMMIT;

-- ── REVERSA ──────────────────────────────────────────────────────────────────
-- El portal anterior sigue leyendo banco_imagenes (no se tocó). Para volver atrás sin perder lo creado como recurso, copia antes
-- a banco_imagenes lo que tenga tipo imagen/video y un enlace, y después:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.recursos;
--   DROP TABLE IF EXISTS public.recursos;  DROP FUNCTION IF EXISTS public.recursos_fijar();  DROP FUNCTION IF EXISTS public.recursos_partes_validas(jsonb);
