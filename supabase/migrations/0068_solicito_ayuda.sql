-- ══════════════════════════════════════════════════════════════════════
--  0068 — «Solicito tu ayuda»: pedir ayuda a un ROL y que alguien de ese rol la tome
-- ══════════════════════════════════════════════════════════════════════
--
--  PEDIDO DEL DUEÑO. «Apartado para todos de solicito tu ayuda para todos los roles y miembros. Que esto sea solicitar ayuda por
--  roles y alguien de ese rol pueda tomar la tarea y se notifique.»
--
--  FLUJO.   abierta → tomada → resuelta (→ confirmada por quien pidió)        · cancelada (por quien pidió, o la administración)
--    1. Una persona con el acceso aprobado (miembro, secretaría o administración) PIDE ayuda a un rol: título, descripción, prioridad,
--       fecha límite y enlace (opcionales) y si es de SU distrito o de todo el equipo.
--    2. Cualquier persona que tenga ese rol (el principal de profiles.rol_id o el segundo de persona_roles, 0062) puede TOMARLA.
--       La toma es ATÓMICA: un UPDATE condicional (… WHERE estado = 'abierta') decide, así que si dos personas pulsan a la vez, gana UNA y
--       la otra recibe «ya la tomó alguien». Quien tomó puede soltarla (vuelve a abierta) o marcarla resuelta.
--    3. Quien pidió CONFIRMA la resolución (queda `confirmada_en`) o la REABRE con una nota (vuelve a «tomada», con la misma persona).
--    4. Quien pidió puede CANCELAR mientras no esté resuelta. La administración ve todo y puede reasignar, resolver, confirmar o cancelar.
--
--  QUIÉN VE QUÉ (RLS de SELECT; Realtime usa la misma).  Se ve: lo que uno pidió · lo que uno tomó · lo ABIERTO para un rol que uno
--  tiene (si es de distrito, solo del mismo distrito) · todo lo del distrito de la secretaría · TODO la administración.
--  Quien no tiene el rol no ve ni cuenta el pedido. Una persona sin acceso aprobado no ve nada.
--
--  ESCRITURA: NINGUNA directa. Las tablas solo se leen; todo cambio pasa por funciones SECURITY DEFINER (ayuda_crear, ayuda_tomar,
--  ayuda_soltar, ayuda_resolver, ayuda_confirmar, ayuda_reabrir, ayuda_cancelar, ayuda_reasignar), cada una con su guardia. Autor,
--  distrito y gestión los fija el servidor. REVOKE a PUBLIC/anon; GRANT solo a authenticated.
--
--  HISTORIAL: `ayuda_eventos` es APPEND-ONLY (como tarea_eventos): lo escriben las funciones; nadie lo modifica (trigger + sin permisos).
--  AUDITORÍA GLOBAL (0055): cada cambio queda en `auditoria_global` con origen «Ayuda» (sin la descripción ni la nota: solo título e ids).
--  AVISOS (0040): 5 tipos nuevos en `notif_tipos` — ayuda_solicitada (al rol; opcional por correo), ayuda_tomada (esencial),
--  ayuda_resuelta, ayuda_cancelada, ayuda_reabierta. Los datos del aviso son solo el título, nombres y la prioridad; nunca la
--  descripción ni la nota. Si 0040 o 0055 no están, las funciones siguen y simplemente no avisan / no auditan.
--  TIEMPO REAL: `ayuda_pedidos` se añade a la publicación supabase_realtime (tiene RLS y clave primaria) y core/sync.js la escucha.
--
--  QUÉ NO TOCA: ninguna tabla, política ni función existente (solo AÑADE filas al catálogo de avisos). Paridad: nada de lo ya guardado cambia.
--  Requiere 0013 (gestion_id_escribible), 0021 (persona_roles), 0058 (es_persona_aprobada). Aplicar DESPUÉS de 0064. Idempotente.
--  Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Acceso aprobado (ya existe desde 0058; se repite por si se aplica sola) ─────────────────────
CREATE OR REPLACE FUNCTION public.es_persona_aprobada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND aprobado IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.es_persona_aprobada() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_persona_aprobada() TO authenticated;

-- ── 1. Tablas ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ayuda_pedidos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id     BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  titulo         TEXT   NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 3 AND 120),
  descripcion    TEXT   NOT NULL DEFAULT '' CHECK (char_length(descripcion) <= 1000),
  rol_id         BIGINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,       -- el rol al que se le pide
  prioridad      TEXT   NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),
  fecha_limite   DATE,
  enlace         TEXT   CHECK (enlace IS NULL OR (char_length(enlace) <= 1000 AND enlace ~* '^https?://[^[:space:]]+$')),
  alcance        TEXT   NOT NULL DEFAULT 'todos' CHECK (alcance IN ('distrito', 'todos')),
  distrito       TEXT,                                                                -- el de quien pidió (lo fija el servidor)
  estado         TEXT   NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'tomada', 'resuelta', 'cancelada')),
  solicitante_id UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tomada_por     UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  tomada_en      TIMESTAMPTZ,
  resuelta_en    TIMESTAMPTZ,
  confirmada_en  TIMESTAMPTZ,
  cancelada_en   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ayuda_alcance_distrito CHECK (alcance = 'todos' OR distrito IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ayuda_pedidos_gestion_idx ON public.ayuda_pedidos (gestion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ayuda_pedidos_rol_idx     ON public.ayuda_pedidos (rol_id, estado);
CREATE INDEX IF NOT EXISTS ayuda_pedidos_solic_idx   ON public.ayuda_pedidos (solicitante_id);
CREATE INDEX IF NOT EXISTS ayuda_pedidos_tomada_idx  ON public.ayuda_pedidos (tomada_por);

CREATE TABLE IF NOT EXISTS public.ayuda_eventos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id  BIGINT NOT NULL REFERENCES public.ayuda_pedidos(id) ON DELETE CASCADE,
  tipo       TEXT   NOT NULL CHECK (tipo IN ('creada', 'tomada', 'soltada', 'resuelta', 'confirmada', 'reabierta', 'cancelada', 'reasignada')),
  actor_id   UUID,
  persona_id UUID,                                    -- a quién se refiere (quien tomó / a quien se reasignó)
  de         TEXT,
  a          TEXT,
  nota       TEXT   CHECK (nota IS NULL OR char_length(nota) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ayuda_eventos_pedido_idx ON public.ayuda_eventos (pedido_id, created_at);

-- Historial append-only: ni el dueño de la función lo modifica por accidente.
CREATE OR REPLACE FUNCTION public.ayuda_eventos_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial de ayuda no se modifica.' USING ERRCODE = '42501'; END $$;
REVOKE EXECUTE ON FUNCTION public.ayuda_eventos_inmutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ayuda_eventos_inmutable ON public.ayuda_eventos;
CREATE TRIGGER ayuda_eventos_inmutable BEFORE UPDATE ON public.ayuda_eventos FOR EACH ROW EXECUTE FUNCTION public.ayuda_eventos_inmutable();

-- ── 2. Quién tiene qué rol y quién puede ver / tomar (internas: las usan las políticas y las funciones) ─────────
CREATE OR REPLACE FUNCTION public.ayuda_roles_de(p UUID) RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(DISTINCT r), '{}'::bigint[]) FROM (
    SELECT rol_id::bigint AS r FROM profiles WHERE id = p AND rol_id IS NOT NULL
    UNION
    SELECT rol_id::bigint FROM persona_roles WHERE persona_id = p) x
$$;
REVOKE EXECUTE ON FUNCTION public.ayuda_roles_de(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ayuda_mi_distrito() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT distrito FROM profiles WHERE id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.ayuda_mi_distrito() FROM PUBLIC, anon, authenticated;

-- ¿Puede quien llama TOMAR este pedido ahora? (abierta, de otra persona, de un rol que tiene, y de su distrito si es de distrito)
CREATE OR REPLACE FUNCTION public.ayuda_puede_tomar(p_rol BIGINT, p_estado TEXT, p_alcance TEXT, p_distrito TEXT, p_solicitante UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(auth.uid() IS NOT NULL AND public.es_persona_aprobada()
     AND p_estado = 'abierta' AND p_solicitante IS DISTINCT FROM auth.uid()
     AND p_rol = ANY (public.ayuda_roles_de(auth.uid()))
     AND (p_alcance = 'todos' OR p_distrito IS NOT DISTINCT FROM public.ayuda_mi_distrito()), false)
$$;
REVOKE EXECUTE ON FUNCTION public.ayuda_puede_tomar(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ayuda_puede_ver(p_rol BIGINT, p_estado TEXT, p_alcance TEXT, p_distrito TEXT, p_solicitante UUID, p_tomada UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(auth.uid() IS NOT NULL AND public.es_persona_aprobada() AND (
       public.is_admin()
    OR COALESCE(p_solicitante = auth.uid(), false)
    OR COALESCE(p_tomada = auth.uid(), false)
    OR (p_estado = 'abierta' AND p_rol = ANY (public.ayuda_roles_de(auth.uid()))
        AND (p_alcance = 'todos' OR p_distrito IS NOT DISTINCT FROM public.ayuda_mi_distrito()))
    OR (public.is_secretario() AND p_distrito IS NOT NULL AND p_distrito IS NOT DISTINCT FROM public.ayuda_mi_distrito())
  ), false)
$$;
-- La política RLS se evalúa con el rol de quien lee: `authenticated` necesita EXECUTE aquí (anon no). Solo responde sí/no sobre lo que se le pasa.
REVOKE EXECUTE ON FUNCTION public.ayuda_puede_ver(BIGINT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ayuda_puede_ver(BIGINT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ── 3. RLS: solo lectura desde el cliente ───────────────────────────────────────────────────────────
ALTER TABLE public.ayuda_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ayuda_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ayuda_pedidos, public.ayuda_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ayuda_pedidos, public.ayuda_eventos TO authenticated;

DROP POLICY IF EXISTS ayuda_pedidos_leer ON public.ayuda_pedidos;
CREATE POLICY ayuda_pedidos_leer ON public.ayuda_pedidos FOR SELECT TO authenticated
  USING (public.ayuda_puede_ver(rol_id, estado, alcance, distrito, solicitante_id, tomada_por));

DROP POLICY IF EXISTS ayuda_eventos_leer ON public.ayuda_eventos;
CREATE POLICY ayuda_eventos_leer ON public.ayuda_eventos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ayuda_pedidos p WHERE p.id = pedido_id));      -- aplica la RLS del pedido

-- ── 4. Internas: historial, auditoría y avisos (nunca hacen fallar la operación) ────────────────────────
CREATE OR REPLACE FUNCTION public._ayuda_evento(p_pedido BIGINT, p_tipo TEXT, p_persona UUID, p_de TEXT, p_a TEXT, p_nota TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v BIGINT;
BEGIN
  INSERT INTO ayuda_eventos (pedido_id, tipo, actor_id, persona_id, de, a, nota)
  VALUES (p_pedido, p_tipo, auth.uid(), p_persona, p_de, p_a, NULLIF(left(btrim(COALESCE(p_nota, '')), 500), ''))
  RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public._ayuda_evento(BIGINT, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ayuda_auditar(p_accion TEXT, p_pedido ayuda_pedidos, p_resumen TEXT, p_antes JSONB, p_despues JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF to_regprocedure('public._auditar(text,text,text,text,text,jsonb,jsonb)') IS NULL THEN RETURN; END IF;
  PERFORM public._auditar('Ayuda', p_accion, 'Pedido de ayuda: ' || p_pedido.titulo, p_pedido.id::TEXT, p_resumen, p_antes, p_despues);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public._ayuda_auditar(TEXT, ayuda_pedidos, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ayuda_avisar(p_tipo TEXT, p_dest UUID[], p_datos JSONB, p_pedido BIGINT, p_evento BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF to_regprocedure('public.notif_emitir(text,uuid[],jsonb,text,text,text,uuid,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  PERFORM public.notif_emitir(p_tipo, p_dest, p_datos, 'ayuda', p_pedido::TEXT, 'e' || p_evento, auth.uid());
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public._ayuda_avisar(TEXT, UUID[], JSONB, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;

-- A quién le toca un pedido: quien tiene el rol (principal o segundo), con acceso aprobado, y del distrito si el pedido es de distrito.
CREATE OR REPLACE FUNCTION public._ayuda_audiencia(p_rol BIGINT, p_alcance TEXT, p_distrito TEXT) RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(DISTINCT p.id), '{}'::uuid[]) FROM profiles p
   WHERE p.aprobado IS NOT FALSE
     AND (p.rol_id = p_rol OR EXISTS (SELECT 1 FROM persona_roles pr WHERE pr.persona_id = p.id AND pr.rol_id = p_rol))
     AND (p_alcance = 'todos' OR p.distrito IS NOT DISTINCT FROM p_distrito)
$$;
REVOKE EXECUTE ON FUNCTION public._ayuda_audiencia(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ayuda_nombre(p UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NULLIF(btrim(nombre), '') FROM profiles WHERE id = p
$$;
REVOKE EXECUTE ON FUNCTION public._ayuda_nombre(UUID) FROM PUBLIC, anon, authenticated;

-- Datos de un aviso (lista blanca de notif_tipos): título, rol, nombres, prioridad y fecha. NUNCA la descripción ni la nota.
CREATE OR REPLACE FUNCTION public._ayuda_datos(p ayuda_pedidos, p_persona UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'titulo', p.titulo, 'rol', (SELECT nombre FROM roles WHERE id = p.rol_id), 'solicitante', public._ayuda_nombre(p.solicitante_id),
    'persona', public._ayuda_nombre(p_persona), 'prioridad', p.prioridad,
    'fecha_limite', CASE WHEN p.fecha_limite IS NULL THEN NULL ELSE to_char(p.fecha_limite, 'DD/MM/YYYY') END,
    'alcance', CASE WHEN p.alcance = 'distrito' THEN 'Solo el distrito ' || COALESCE(p.distrito, '') ELSE 'Todo el equipo' END))
$$;
REVOKE EXECUTE ON FUNCTION public._ayuda_datos(ayuda_pedidos, UUID) FROM PUBLIC, anon, authenticated;

-- Carga un pedido para escribir sobre él (bloquea la fila) y comprueba que su gestión admite escritura.
CREATE OR REPLACE FUNCTION public._ayuda_cargar(p_id BIGINT) RETURNS ayuda_pedidos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos;
BEGIN
  IF auth.uid() IS NULL OR NOT public.es_persona_aprobada() THEN RAISE EXCEPTION 'Se requiere una sesión con acceso aprobado.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM ayuda_pedidos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.ayuda_puede_ver(r.rol_id, r.estado, r.alcance, r.distrito, r.solicitante_id, r.tomada_por) THEN
    RAISE EXCEPTION 'Esa solicitud de ayuda no existe o no puedes verla.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestion_id_escribible(r.gestion_id) THEN RAISE EXCEPTION 'La gestión de esta solicitud está archivada: es solo de lectura.'; END IF;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public._ayuda_cargar(BIGINT) FROM PUBLIC, anon, authenticated;

-- ── 5. Crear ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_crear(
  p_titulo TEXT, p_descripcion TEXT, p_rol_id BIGINT, p_prioridad TEXT DEFAULT 'normal', p_fecha_limite DATE DEFAULT NULL,
  p_enlace TEXT DEFAULT NULL, p_alcance TEXT DEFAULT 'todos'
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_yo UUID := auth.uid(); v_dist TEXT; v_gest BIGINT; v_t TEXT := btrim(COALESCE(p_titulo, '')); v_enl TEXT := NULLIF(btrim(COALESCE(p_enlace, '')), '');
  v_alc TEXT := COALESCE(NULLIF(p_alcance, ''), 'todos'); v_pri TEXT := COALESCE(NULLIF(p_prioridad, ''), 'normal'); r ayuda_pedidos; v_ev BIGINT;
BEGIN
  IF v_yo IS NULL OR NOT public.es_persona_aprobada() THEN RAISE EXCEPTION 'Se requiere una sesión con acceso aprobado.' USING ERRCODE = '42501'; END IF;
  IF char_length(v_t) < 3 OR char_length(v_t) > 120 THEN RAISE EXCEPTION 'El título debe tener entre 3 y 120 caracteres.'; END IF;
  IF char_length(COALESCE(p_descripcion, '')) > 1000 THEN RAISE EXCEPTION 'La descripción admite hasta 1000 caracteres.'; END IF;
  IF v_pri NOT IN ('baja', 'normal', 'alta', 'urgente') THEN RAISE EXCEPTION 'La prioridad no es válida.'; END IF;
  IF v_alc NOT IN ('distrito', 'todos') THEN RAISE EXCEPTION 'El alcance no es válido.'; END IF;
  IF v_enl IS NOT NULL AND (char_length(v_enl) > 1000 OR v_enl !~* '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION 'El enlace debe empezar por http:// o https://.'; END IF;
  IF p_fecha_limite IS NOT NULL AND p_fecha_limite < CURRENT_DATE - 1 THEN RAISE EXCEPTION 'La fecha límite ya pasó.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = p_rol_id AND COALESCE(activo, true)) THEN RAISE EXCEPTION 'Elige un rol que exista.'; END IF;
  SELECT distrito INTO v_dist FROM profiles WHERE id = v_yo;
  IF v_alc = 'distrito' AND v_dist IS NULL THEN RAISE EXCEPTION 'Tu cuenta no tiene distrito: pide la ayuda a todo el equipo.'; END IF;
  SELECT id INTO v_gest FROM gestiones WHERE activa ORDER BY id DESC LIMIT 1;
  IF v_gest IS NULL OR NOT public.gestion_id_escribible(v_gest) THEN RAISE EXCEPTION 'No hay una gestión abierta para registrar la solicitud.'; END IF;
  IF (SELECT count(*) FROM ayuda_pedidos WHERE solicitante_id = v_yo AND gestion_id = v_gest AND estado IN ('abierta', 'tomada')) >= 10 THEN
    RAISE EXCEPTION 'Ya tienes 10 solicitudes en curso. Cierra o cancela alguna antes de pedir otra.';
  END IF;

  INSERT INTO ayuda_pedidos (gestion_id, titulo, descripcion, rol_id, prioridad, fecha_limite, enlace, alcance, distrito, solicitante_id)
  VALUES (v_gest, v_t, btrim(COALESCE(p_descripcion, '')), p_rol_id, v_pri, p_fecha_limite, v_enl, v_alc, v_dist, v_yo)
  RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'creada', NULL, NULL, 'abierta', NULL);
  PERFORM public._ayuda_auditar('ayuda_creada', r, 'Pidió ayuda al rol · prioridad ' || r.prioridad, NULL,
    jsonb_build_object('estado', 'abierta', 'rol_id', r.rol_id, 'alcance', r.alcance));
  PERFORM public._ayuda_avisar('ayuda_solicitada', public._ayuda_audiencia(r.rol_id, r.alcance, r.distrito), public._ayuda_datos(r, v_yo), r.id, v_ev);
  RETURN r.id;
END $$;

-- ── 6. Tomar (atómico) ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_tomar(p_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_yo UUID := auth.uid(); r ayuda_pedidos; v_ev BIGINT;
BEGIN
  IF v_yo IS NULL OR NOT public.es_persona_aprobada() THEN RAISE EXCEPTION 'Se requiere una sesión con acceso aprobado.' USING ERRCODE = '42501'; END IF;
  -- UNA sentencia decide: si dos personas llegan a la vez, la segunda ve la fila ya tomada y no actualiza nada.
  UPDATE ayuda_pedidos p SET estado = 'tomada', tomada_por = v_yo, tomada_en = now(), updated_at = now()
   WHERE p.id = p_id AND p.estado = 'abierta' AND p.solicitante_id <> v_yo
     AND p.rol_id = ANY (public.ayuda_roles_de(v_yo))
     AND (p.alcance = 'todos' OR p.distrito IS NOT DISTINCT FROM public.ayuda_mi_distrito())
     AND public.gestion_id_escribible(p.gestion_id)
  RETURNING * INTO r;
  IF NOT FOUND THEN
    SELECT * INTO r FROM ayuda_pedidos WHERE id = p_id;
    -- Quien tiene el rol (y el distrito, si es de distrito) sigue pudiendo saber que «ya la tomaron» aunque haya dejado de verla.
    IF NOT FOUND OR NOT (public.ayuda_puede_ver(r.rol_id, r.estado, r.alcance, r.distrito, r.solicitante_id, r.tomada_por)
                         OR (r.rol_id = ANY (public.ayuda_roles_de(v_yo)) AND (r.alcance = 'todos' OR r.distrito IS NOT DISTINCT FROM public.ayuda_mi_distrito()))) THEN
      RAISE EXCEPTION 'Esa solicitud de ayuda no existe o no puedes verla.' USING ERRCODE = '42501';
    ELSIF r.estado = 'tomada' THEN RAISE EXCEPTION 'Ya la tomó alguien más.';
    ELSIF r.estado <> 'abierta' THEN RAISE EXCEPTION 'Esta solicitud ya no está abierta.';
    ELSIF r.solicitante_id = v_yo THEN RAISE EXCEPTION 'No puedes tomar tu propia solicitud.';
    ELSIF NOT (r.rol_id = ANY (public.ayuda_roles_de(v_yo))) THEN RAISE EXCEPTION 'Esta solicitud es para otro rol.';
    ELSIF NOT public.gestion_id_escribible(r.gestion_id) THEN RAISE EXCEPTION 'La gestión de esta solicitud está archivada: es solo de lectura.';
    ELSE RAISE EXCEPTION 'Es solo para el distrito de quien la pidió.';
    END IF;
  END IF;
  v_ev := public._ayuda_evento(r.id, 'tomada', v_yo, 'abierta', 'tomada', NULL);
  PERFORM public._ayuda_auditar('ayuda_tomada', r, 'La tomó una persona del rol', jsonb_build_object('estado', 'abierta'), jsonb_build_object('estado', 'tomada', 'tomada_por', v_yo));
  PERFORM public._ayuda_avisar('ayuda_tomada', ARRAY[r.solicitante_id], public._ayuda_datos(r, v_yo), r.id, v_ev);
  RETURN true;
END $$;

-- ── 7. Soltar (quien la tomó, o la administración): vuelve a abierta ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_soltar(p_id BIGINT, p_nota TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos; v_ant UUID; v_ev BIGINT;
BEGIN
  r := public._ayuda_cargar(p_id); v_ant := r.tomada_por;
  IF r.estado <> 'tomada' THEN RAISE EXCEPTION 'Solo se puede soltar una solicitud que está tomada.'; END IF;
  IF NOT (r.tomada_por = auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Solo quien la tomó (o la administración) puede soltarla.' USING ERRCODE = '42501'; END IF;
  UPDATE ayuda_pedidos SET estado = 'abierta', tomada_por = NULL, tomada_en = NULL, updated_at = now() WHERE id = r.id RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'soltada', v_ant, 'tomada', 'abierta', p_nota);
  PERFORM public._ayuda_auditar('ayuda_soltada', r, 'Volvió a quedar abierta', jsonb_build_object('estado', 'tomada', 'tomada_por', v_ant), jsonb_build_object('estado', 'abierta'));
  PERFORM public._ayuda_avisar('ayuda_solicitada', public._ayuda_audiencia(r.rol_id, r.alcance, r.distrito), public._ayuda_datos(r, r.solicitante_id), r.id, v_ev);
  RETURN true;
END $$;

-- ── 8. Resolver (quien la tomó, o la administración) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_resolver(p_id BIGINT, p_nota TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos; v_ev BIGINT;
BEGIN
  r := public._ayuda_cargar(p_id);
  IF r.estado <> 'tomada' THEN RAISE EXCEPTION 'Solo se puede resolver una solicitud que está tomada.'; END IF;
  IF NOT (r.tomada_por = auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Solo quien la tomó (o la administración) puede marcarla resuelta.' USING ERRCODE = '42501'; END IF;
  UPDATE ayuda_pedidos SET estado = 'resuelta', resuelta_en = now(), confirmada_en = NULL, updated_at = now() WHERE id = r.id RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'resuelta', r.tomada_por, 'tomada', 'resuelta', p_nota);
  PERFORM public._ayuda_auditar('ayuda_resuelta', r, 'Se marcó como resuelta', jsonb_build_object('estado', 'tomada'), jsonb_build_object('estado', 'resuelta'));
  PERFORM public._ayuda_avisar('ayuda_resuelta', ARRAY[r.solicitante_id], public._ayuda_datos(r, r.tomada_por), r.id, v_ev);
  RETURN true;
END $$;

-- ── 9. Confirmar (quien pidió, o la administración) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_confirmar(p_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos;
BEGIN
  r := public._ayuda_cargar(p_id);
  IF r.estado <> 'resuelta' THEN RAISE EXCEPTION 'Solo se confirma una solicitud que ya está resuelta.'; END IF;
  IF r.confirmada_en IS NOT NULL THEN RETURN true; END IF;
  IF NOT (r.solicitante_id = auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Solo quien pidió la ayuda (o la administración) la confirma.' USING ERRCODE = '42501'; END IF;
  UPDATE ayuda_pedidos SET confirmada_en = now(), updated_at = now() WHERE id = r.id RETURNING * INTO r;
  PERFORM public._ayuda_evento(r.id, 'confirmada', r.tomada_por, 'resuelta', 'resuelta', NULL);
  PERFORM public._ayuda_auditar('ayuda_confirmada', r, 'Quien pidió confirmó la resolución', NULL, jsonb_build_object('estado', 'resuelta', 'confirmada', true));
  RETURN true;
END $$;

-- ── 10. Reabrir (quien pidió, o la administración): vuelve a «tomada» con la misma persona ───────────
CREATE OR REPLACE FUNCTION public.ayuda_reabrir(p_id BIGINT, p_nota TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos; v_ev BIGINT;
BEGIN
  r := public._ayuda_cargar(p_id);
  IF r.estado <> 'resuelta' THEN RAISE EXCEPTION 'Solo se reabre una solicitud que está resuelta.'; END IF;
  IF NOT (r.solicitante_id = auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Solo quien pidió la ayuda (o la administración) puede reabrirla.' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(p_nota, ''))) < 3 THEN RAISE EXCEPTION 'Cuenta en una frase qué falta: así quien te ayuda sabe qué retomar.'; END IF;
  UPDATE ayuda_pedidos SET estado = CASE WHEN tomada_por IS NULL THEN 'abierta' ELSE 'tomada' END, resuelta_en = NULL, confirmada_en = NULL, updated_at = now()
   WHERE id = r.id RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'reabierta', r.tomada_por, 'resuelta', r.estado, p_nota);
  PERFORM public._ayuda_auditar('ayuda_reabierta', r, 'Se reabrió: faltaba algo', jsonb_build_object('estado', 'resuelta'), jsonb_build_object('estado', r.estado));
  IF r.tomada_por IS NOT NULL THEN
    PERFORM public._ayuda_avisar('ayuda_reabierta', ARRAY[r.tomada_por], public._ayuda_datos(r, r.solicitante_id), r.id, v_ev);
  ELSE
    PERFORM public._ayuda_avisar('ayuda_solicitada', public._ayuda_audiencia(r.rol_id, r.alcance, r.distrito), public._ayuda_datos(r, r.solicitante_id), r.id, v_ev);
  END IF;
  RETURN true;
END $$;

-- ── 11. Cancelar (quien pidió, o la administración), mientras no esté resuelta ────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_cancelar(p_id BIGINT, p_nota TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos; v_de TEXT; v_ev BIGINT; v_dest UUID[];
BEGIN
  r := public._ayuda_cargar(p_id); v_de := r.estado;
  IF r.estado NOT IN ('abierta', 'tomada') THEN RAISE EXCEPTION 'Solo se cancela una solicitud abierta o tomada.'; END IF;
  IF NOT (r.solicitante_id = auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Solo quien pidió la ayuda (o la administración) puede cancelarla.' USING ERRCODE = '42501'; END IF;
  UPDATE ayuda_pedidos SET estado = 'cancelada', cancelada_en = now(), updated_at = now() WHERE id = r.id RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'cancelada', r.tomada_por, v_de, 'cancelada', p_nota);
  PERFORM public._ayuda_auditar('ayuda_cancelada', r, CASE WHEN auth.uid() = r.solicitante_id THEN 'La canceló quien la pidió' ELSE 'La canceló la administración' END,
    jsonb_build_object('estado', v_de), jsonb_build_object('estado', 'cancelada'));
  -- Se avisa a quien la había tomado y, si cancela la administración, también a quien pidió. (notif_emitir omite al propio actor.)
  v_dest := ARRAY[]::uuid[];
  IF r.tomada_por IS NOT NULL THEN v_dest := v_dest || r.tomada_por; END IF;
  v_dest := v_dest || r.solicitante_id;
  PERFORM public._ayuda_avisar('ayuda_cancelada', v_dest, public._ayuda_datos(r, auth.uid()), r.id, v_ev);
  RETURN true;
END $$;

-- ── 12. Reasignar (solo administración) ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ayuda_reasignar(p_id BIGINT, p_persona UUID, p_nota TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r ayuda_pedidos; v_de TEXT; v_ant UUID; v_ev BIGINT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo la administración reasigna solicitudes.' USING ERRCODE = '42501'; END IF;
  r := public._ayuda_cargar(p_id); v_de := r.estado; v_ant := r.tomada_por;
  IF r.estado NOT IN ('abierta', 'tomada') THEN RAISE EXCEPTION 'Solo se reasigna una solicitud abierta o tomada.'; END IF;
  IF p_persona IS NULL OR NOT (p_persona = ANY (public._ayuda_audiencia(r.rol_id, 'todos', NULL))) THEN
    RAISE EXCEPTION 'Esa persona no tiene el rol que se pidió.';
  END IF;
  IF p_persona = r.solicitante_id THEN RAISE EXCEPTION 'No se puede asignar la solicitud a quien la pidió.'; END IF;
  UPDATE ayuda_pedidos SET estado = 'tomada', tomada_por = p_persona, tomada_en = now(), updated_at = now() WHERE id = r.id RETURNING * INTO r;
  v_ev := public._ayuda_evento(r.id, 'reasignada', p_persona, v_de, 'tomada', p_nota);
  PERFORM public._ayuda_auditar('ayuda_reasignada', r, 'La administración la asignó a una persona del rol', jsonb_build_object('estado', v_de, 'tomada_por', v_ant),
    jsonb_build_object('estado', 'tomada', 'tomada_por', p_persona));
  PERFORM public._ayuda_avisar('ayuda_solicitada', ARRAY[p_persona], public._ayuda_datos(r, r.solicitante_id), r.id, v_ev);
  PERFORM public._ayuda_avisar('ayuda_tomada', ARRAY[r.solicitante_id], public._ayuda_datos(r, p_persona), r.id, v_ev);
  RETURN true;
END $$;

-- ── 13. Lectura con nombres (las personas no se leen entre sí en profiles; aquí solo lo que cada quien puede ver) ──────────
CREATE OR REPLACE FUNCTION public.ayuda_listar(p_gestion BIGINT DEFAULT NULL)
RETURNS TABLE (
  id BIGINT, gestion_id BIGINT, titulo TEXT, descripcion TEXT, rol_id BIGINT, rol_nombre TEXT, prioridad TEXT, fecha_limite DATE, enlace TEXT,
  alcance TEXT, distrito TEXT, estado TEXT, solicitante_id UUID, solicitante_nombre TEXT, tomada_por UUID, tomada_nombre TEXT,
  tomada_en TIMESTAMPTZ, resuelta_en TIMESTAMPTZ, confirmada_en TIMESTAMPTZ, cancelada_en TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  puedo_tomar BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_g BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.es_persona_aprobada() THEN RAISE EXCEPTION 'Se requiere una sesión con acceso aprobado.' USING ERRCODE = '42501'; END IF;
  v_g := COALESCE(p_gestion, (SELECT g.id FROM gestiones g WHERE g.activa ORDER BY g.id DESC LIMIT 1));
  RETURN QUERY
  SELECT p.id, p.gestion_id, p.titulo, p.descripcion, p.rol_id, r.nombre, p.prioridad, p.fecha_limite, p.enlace, p.alcance, p.distrito, p.estado,
         p.solicitante_id, public._ayuda_nombre(p.solicitante_id), p.tomada_por, public._ayuda_nombre(p.tomada_por),
         p.tomada_en, p.resuelta_en, p.confirmada_en, p.cancelada_en, p.created_at, p.updated_at,
         public.ayuda_puede_tomar(p.rol_id, p.estado, p.alcance, p.distrito, p.solicitante_id)
    FROM ayuda_pedidos p JOIN roles r ON r.id = p.rol_id
   WHERE p.gestion_id = v_g AND public.ayuda_puede_ver(p.rol_id, p.estado, p.alcance, p.distrito, p.solicitante_id, p.tomada_por)
   ORDER BY p.created_at DESC, p.id DESC LIMIT 500;
END $$;

CREATE OR REPLACE FUNCTION public.ayuda_historial(p_id BIGINT)
RETURNS TABLE (id BIGINT, tipo TEXT, actor_id UUID, actor_nombre TEXT, persona_id UUID, persona_nombre TEXT, de TEXT, a TEXT, nota TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.es_persona_aprobada() THEN RAISE EXCEPTION 'Se requiere una sesión con acceso aprobado.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM ayuda_pedidos p WHERE p.id = p_id AND public.ayuda_puede_ver(p.rol_id, p.estado, p.alcance, p.distrito, p.solicitante_id, p.tomada_por)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT e.id, e.tipo, e.actor_id, public._ayuda_nombre(e.actor_id), e.persona_id, public._ayuda_nombre(e.persona_id), e.de, e.a, e.nota, e.created_at
    FROM ayuda_eventos e WHERE e.pedido_id = p_id ORDER BY e.created_at, e.id;
END $$;

-- Quién podría tomar un pedido (para que la administración reasigne).
CREATE OR REPLACE FUNCTION public.ayuda_candidatas(p_id BIGINT) RETURNS TABLE (id UUID, nombre TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo la administración consulta esto.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT pr.id, COALESCE(NULLIF(btrim(pr.nombre), ''), pr.email) FROM ayuda_pedidos p
    JOIN profiles pr ON pr.id = ANY (public._ayuda_audiencia(p.rol_id, 'todos', NULL)) AND pr.id <> p.solicitante_id
   WHERE p.id = p_id ORDER BY 2;
END $$;

-- ── 14. Permisos de las funciones públicas ────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION
  public.ayuda_crear(TEXT, TEXT, BIGINT, TEXT, DATE, TEXT, TEXT), public.ayuda_tomar(BIGINT), public.ayuda_soltar(BIGINT, TEXT),
  public.ayuda_resolver(BIGINT, TEXT), public.ayuda_confirmar(BIGINT), public.ayuda_reabrir(BIGINT, TEXT), public.ayuda_cancelar(BIGINT, TEXT),
  public.ayuda_reasignar(BIGINT, UUID, TEXT), public.ayuda_listar(BIGINT), public.ayuda_historial(BIGINT), public.ayuda_candidatas(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.ayuda_crear(TEXT, TEXT, BIGINT, TEXT, DATE, TEXT, TEXT), public.ayuda_tomar(BIGINT), public.ayuda_soltar(BIGINT, TEXT),
  public.ayuda_resolver(BIGINT, TEXT), public.ayuda_confirmar(BIGINT), public.ayuda_reabrir(BIGINT, TEXT), public.ayuda_cancelar(BIGINT, TEXT),
  public.ayuda_reasignar(BIGINT, UUID, TEXT), public.ayuda_listar(BIGINT), public.ayuda_historial(BIGINT), public.ayuda_candidatas(BIGINT)
  TO authenticated;

-- ── 15. Catálogo de avisos (0040) ─────────────────────────────────────────────────────────────────────
-- [CATALOGO-AVISOS-INICIO]  (tools/pruebas/correo.mjs ejecuta solo este bloque sobre una base con 0040)
DO $m68$
BEGIN
  IF to_regclass('public.notif_tipos') IS NULL THEN
    RAISE NOTICE '0068: no existe notif_tipos (falta 0040); las solicitudes de ayuda funcionan, pero sin avisos.';
    RETURN;
  END IF;
  INSERT INTO public.notif_tipos (tipo, categoria, titulo, descripcion, esencial, correo_default, audiencia, claves, requeridas, ref_tipo, destino, orden) VALUES
   ('ayuda_solicitada', 'tareas', 'Te piden ayuda', 'Alguien pide ayuda a tu rol (o te asignan una solicitud).', false, true,
     ARRAY['admin','secretario','miembro'], ARRAY['titulo','rol','solicitante','prioridad','fecha_limite','alcance'], ARRAY['titulo'],
     'ayuda', '{"admin":"apoyo","secretario":"apoyo","miembro":"apoyo"}', 60),
   ('ayuda_tomada', 'tareas', 'Alguien tomó tu solicitud de ayuda', 'Una persona de ese rol tomó la ayuda que pediste.', true, true,
     ARRAY['admin','secretario','miembro'], ARRAY['titulo','rol','persona'], ARRAY['titulo','persona'],
     'ayuda', '{"admin":"apoyo","secretario":"apoyo","miembro":"apoyo"}', 61),
   ('ayuda_resuelta', 'tareas', 'Marcaron resuelta tu solicitud de ayuda', 'Quien te ayudaba marcó la solicitud como resuelta: confírmala o reábrela.', false, true,
     ARRAY['admin','secretario','miembro'], ARRAY['titulo','rol','persona'], ARRAY['titulo','persona'],
     'ayuda', '{"admin":"apoyo","secretario":"apoyo","miembro":"apoyo"}', 62),
   ('ayuda_cancelada', 'tareas', 'Cancelaron una solicitud de ayuda', 'Se canceló una solicitud de ayuda que tenías tomada (o la tuya, si la canceló la administración).', false, true,
     ARRAY['admin','secretario','miembro'], ARRAY['titulo','rol','persona'], ARRAY['titulo'],
     'ayuda', '{"admin":"apoyo","secretario":"apoyo","miembro":"apoyo"}', 63),
   ('ayuda_reabierta', 'tareas', 'Reabrieron una solicitud de ayuda', 'Quien pidió la ayuda la reabrió: falta algo por retomar.', true, true,
     ARRAY['admin','secretario','miembro'], ARRAY['titulo','rol','persona'], ARRAY['titulo','persona'],
     'ayuda', '{"admin":"apoyo","secretario":"apoyo","miembro":"apoyo"}', 64)
  ON CONFLICT (tipo) DO NOTHING;
END $m68$;
-- [CATALOGO-AVISOS-FIN]

-- ── 16. Tiempo real: se publica ayuda_pedidos (RLS activa y clave primaria; anon sin acceso) ───────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ayuda_pedidos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ayuda_pedidos;
  END IF;
END $$;

COMMIT;

-- ── REVERSA ───────────────────────────────────────────────────────────────────────────────────────────
-- (conserva el historial hasta el último paso; los avisos ya enviados quedan en `notificaciones`)
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.ayuda_pedidos;
--   DELETE FROM public.notif_tipos WHERE tipo IN ('ayuda_solicitada','ayuda_tomada','ayuda_resuelta','ayuda_cancelada','ayuda_reabierta');
--   DROP FUNCTION IF EXISTS public.ayuda_crear(TEXT,TEXT,BIGINT,TEXT,DATE,TEXT,TEXT), public.ayuda_tomar(BIGINT), public.ayuda_soltar(BIGINT,TEXT),
--     public.ayuda_resolver(BIGINT,TEXT), public.ayuda_confirmar(BIGINT), public.ayuda_reabrir(BIGINT,TEXT), public.ayuda_cancelar(BIGINT,TEXT),
--     public.ayuda_reasignar(BIGINT,UUID,TEXT), public.ayuda_listar(BIGINT), public.ayuda_historial(BIGINT), public.ayuda_candidatas(BIGINT);
--   DROP FUNCTION IF EXISTS public._ayuda_cargar(BIGINT), public._ayuda_datos(ayuda_pedidos,UUID), public._ayuda_nombre(UUID), public._ayuda_audiencia(BIGINT,TEXT,TEXT),
--     public._ayuda_avisar(TEXT,UUID[],JSONB,BIGINT,BIGINT), public._ayuda_auditar(TEXT,ayuda_pedidos,TEXT,JSONB,JSONB), public._ayuda_evento(BIGINT,TEXT,UUID,TEXT,TEXT,TEXT);
--   DROP TABLE IF EXISTS public.ayuda_eventos; DROP TABLE IF EXISTS public.ayuda_pedidos;   -- ← borra todo el historial de ayuda
--   DROP FUNCTION IF EXISTS public.ayuda_puede_ver(BIGINT,TEXT,TEXT,TEXT,UUID,UUID), public.ayuda_puede_tomar(BIGINT,TEXT,TEXT,TEXT,UUID),
--     public.ayuda_mi_distrito(), public.ayuda_roles_de(UUID), public.ayuda_eventos_inmutable();
--   (es_persona_aprobada() es de 0058: NO se borra)
