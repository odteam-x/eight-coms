-- ══════════════════════════════════════════════════════════════════════
--  0022 — Centro de avisos dentro de la plataforma (la campana)
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--    Reutiliza la cola `notificaciones` de 0019 (la misma que alimenta los correos): cada aviso que
--    hoy sale por correo aparece también en la campana de la persona destinataria, con su estado
--    leído / sin leer. No se crea una tabla nueva ni un segundo sistema de eventos.
--
--  CÓMO
--    · `leida_en` (columna nueva): cuándo la persona marcó el aviso. NO afecta al envío del correo.
--    · La tabla sigue SIN permisos para anon/authenticated: la persona solo accede por cuatro
--      funciones SECURITY DEFINER que filtran por `auth.uid()` ellas mismas. Nadie ve avisos ajenos.
--    · Un aviso programado a futuro (p. ej. «nota corregida», +15 min) aparece cuando llega su hora,
--      igual que el correo.
--    · `ref_id` es el identificador del objeto del aviso (tarea, evaluación, actividad, persona o
--      período), tomado de `dedupe_key` (formato «tipo:ID:…»). El cliente lo usa para abrir la
--      pantalla correcta; no es un dato nuevo.
--
--  SEGURIDAD
--    Guardia con el sentido correcto (IF auth.uid() IS NULL THEN RAISE), ver 0008. Funciones revocadas
--    a PUBLIC y anon (0010) y concedidas solo a `authenticated`.
--
--  Aplicación manual en el SQL Editor, tras 0019. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS leida_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notificaciones_destinatario_idx
  ON public.notificaciones (destinatario_id, enviar_despues DESC);
CREATE INDEX IF NOT EXISTS notificaciones_sin_leer_idx
  ON public.notificaciones (destinatario_id) WHERE leida_en IS NULL;

-- ── Lista (más recientes primero; p_antes pagina) ──────────────────────
CREATE OR REPLACE FUNCTION public.mis_notificaciones(p_limite INT DEFAULT 40, p_antes TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (id BIGINT, tipo TEXT, datos JSONB, ref_id TEXT, creada TIMESTAMPTZ, leida_en TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  RETURN QUERY
    SELECT n.id, n.tipo, n.datos, NULLIF(split_part(COALESCE(n.dedupe_key, ''), ':', 2), ''),
           n.enviar_despues, n.leida_en
      FROM notificaciones n
     WHERE n.destinatario_id = auth.uid()
       AND n.enviar_despues <= NOW()
       AND (p_antes IS NULL OR n.enviar_despues < p_antes)
     ORDER BY n.enviar_despues DESC, n.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 40), 100));
END;
$$;

-- ── Contador de la campana ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_no_leidas() RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  SELECT COUNT(*)::INT INTO v FROM notificaciones n
   WHERE n.destinatario_id = auth.uid() AND n.leida_en IS NULL AND n.enviar_despues <= NOW();
  RETURN v;
END;
$$;

-- ── Marcar una / todas como leídas ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_marcar_leida(p_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  UPDATE notificaciones SET leida_en = COALESCE(leida_en, NOW())
   WHERE id = p_id AND destinatario_id = auth.uid();
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_marcar_todas() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  UPDATE notificaciones SET leida_en = NOW()
   WHERE destinatario_id = auth.uid() AND leida_en IS NULL AND enviar_despues <= NOW();
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mis_notificaciones(INT, TIMESTAMPTZ), public.notif_no_leidas(),
  public.notif_marcar_leida(BIGINT), public.notif_marcar_todas() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mis_notificaciones(INT, TIMESTAMPTZ), public.notif_no_leidas(),
  public.notif_marcar_leida(BIGINT), public.notif_marcar_todas() TO authenticated;
