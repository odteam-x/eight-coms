-- ══════════════════════════════════════════════════════════════════════
--  0015 (seed) — perfiles v1 de los 8 roles de la rúbrica   ⚠ PENDIENTE
-- ══════════════════════════════════════════════════════════════════════
--
--  NO EJECUTAR SIN REVISAR EL MAPEO. Lleva .PENDIENTE a propósito, igual
--  que 0006: depende de una decisión de datos que no es de código.
--
--  La rúbrica define 8 roles. La tabla `roles` tiene los suyos (en el
--  snapshot: Filmmaker, Maquetación, Ideas Creativas, P-CLIT, Motion
--  Editor, X DEFINIR). Cuál corresponde a cuál lo decide quien conoce al
--  equipo. Edita la tabla `mapeo` de abajo:
--
--    rol_rubrica : nombre del rol en la rúbrica (no se cambia)
--    rol_bd      : nombre EXACTO en roles.nombre al que corresponde
--    crear       : true  → si no existe en `roles`, se crea con ese nombre
--                  false → si no existe, se omite con un aviso
--
--  Por defecto cada rol de la rúbrica apunta a un rol con su propio nombre
--  y `crear = true`: crea los 8 y deja los antiguos como están, sin mover a
--  nadie. Reasignar personas a su rol nuevo se hace desde Usuarios, con el
--  selector que ya existe. Si prefieres reutilizar un rol viejo, cambia
--  `rol_bd` (p. ej. 'Motion Editor' para 'Video / Edición').
--
--  Idempotente: si el rol ya tiene perfil en la gestión activa no se toca.
-- ══════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE
  v_gestion BIGINT;
  m         RECORD;
  v_rol     BIGINT;
  v_perfil  BIGINT;
  v_orden   INT;
BEGIN
  SELECT id INTO v_gestion FROM public.gestiones WHERE activa LIMIT 1;
  IF v_gestion IS NULL THEN
    RAISE EXCEPTION 'No hay gestion activa.';
  END IF;

  SELECT COALESCE(MAX(orden), 0) INTO v_orden FROM public.roles;

  FOR m IN
    SELECT * FROM (VALUES
      ('Fotografía',     'Fotografía',     true,
        '{"encuadre":30,"tecnico":25,"diseno":20,"planificacion":15,"revision":10}'::jsonb),
      ('Diseño Gráfico', 'Diseño Gráfico', true,
        '{"diseno":35,"marca":25,"edicion":15,"revision":15,"planificacion":10}'::jsonb),
      ('Video / Edición','Video / Edición',true,
        '{"edicion":30,"tecnico":20,"narrativa":20,"diseno":15,"planificacion":15}'::jsonb),
      ('Redacción',      'Redacción',      true,
        '{"narrativa":35,"ortografia":25,"revision":20,"planificacion":20}'::jsonb),
      ('Redes Sociales', 'Redes Sociales', true,
        '{"redes":30,"metricas":25,"comunidad":20,"narrativa":15,"planificacion":10}'::jsonb),
      ('Producción',     'Producción',     true,
        '{"logistica":35,"recursos":25,"planificacion":25,"revision":15}'::jsonb),
      ('Dirección',      'Dirección',      true,
        '{"liderazgo":30,"vision":25,"planificacion":20,"revision":15,"fluidez":10}'::jsonb),
      ('Comunicaciones', 'Comunicaciones', true,
        '{"mensaje":30,"voceria":25,"fluidez":20,"narrativa":15,"planificacion":10}'::jsonb)
    ) AS t(rol_rubrica, rol_bd, crear, pesos)
  LOOP
    SELECT id INTO v_rol FROM public.roles WHERE nombre = m.rol_bd;

    IF v_rol IS NULL THEN
      IF m.crear THEN
        v_orden := v_orden + 1;
        INSERT INTO public.roles (nombre, activo, orden)
        VALUES (m.rol_bd, true, v_orden) RETURNING id INTO v_rol;
      ELSE
        RAISE NOTICE 'Omitido "%": no existe el rol "%" en roles.', m.rol_rubrica, m.rol_bd;
        CONTINUE;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.perfiles_rol
                WHERE gestion_id = v_gestion AND rol_id = v_rol) THEN
      RAISE NOTICE 'Ya tiene perfil: "%". Sin cambios.', m.rol_bd;
      CONTINUE;
    END IF;

    -- Este INSERT corre como dueño (SQL Editor): no pasa por crear_perfil_rol
    -- porque is_admin() depende de auth.uid(), que aquí es NULL. Las
    -- validaciones (suma = 100, solo técnicos) las hace igual el trigger
    -- diferido al confirmar.
    INSERT INTO public.perfiles_rol (gestion_id, rol_id, version, vigente_desde_periodo)
    VALUES (v_gestion, v_rol, 1, NULL) RETURNING id INTO v_perfil;

    INSERT INTO public.perfil_criterios (perfil_id, criterio_key, peso)
    SELECT v_perfil, key, value::INT FROM jsonb_each_text(m.pesos);
  END LOOP;
END
$seed$;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- 8 perfiles, todos con peso total 100:
--   SELECT r.nombre, pr.version, sum(pc.peso) AS total
--     FROM perfiles_rol pr
--     JOIN roles r ON r.id = pr.rol_id
--     JOIN perfil_criterios pc ON pc.perfil_id = pr.id
--    WHERE pr.gestion_id = (SELECT id FROM gestiones WHERE activa)
--    GROUP BY 1,2 ORDER BY 1;
--
-- Quién se queda sin perfil (rol sin perfil o sin rol):
--   SELECT p.nombre, r.nombre AS rol FROM profiles p
--     LEFT JOIN roles r ON r.id = p.rol_id
--    WHERE NOT p.es_admin
--      AND NOT EXISTS (SELECT 1 FROM perfiles_rol pr
--                       WHERE pr.rol_id = p.rol_id
--                         AND pr.gestion_id = (SELECT id FROM gestiones WHERE activa));

-- DOWN: DELETE FROM perfiles_rol WHERE version = 1 AND gestion_id = <gestion>
--       (solo mientras ninguna evaluación v2 los use; después el trigger lo impide).
