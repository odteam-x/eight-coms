-- ══════════════════════════════════════════════════════════════════════
--  0030 — Fondo de la tarjeta de perfil elegible
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--    `profiles.fondo`: cuál de los siete patrones de la marca (img/patrones/patron-1…7.webp) lleva la tarjeta de la
--    persona. NULL = automático (el de siempre, derivado del id). Solo esas siete opciones: el CHECK no deja otra.
--
--  QUIÉN LO ESCRIBE
--    La propia persona. `profiles_update` ya permite UPDATE sobre la fila propia y el disparador
--    `profiles_bloquear_privilegios` solo bloquea rol, distrito, tipo, acceso y administración: esta columna es
--    cosmética y no está entre ellos, así que no hace falta política nueva. La administración también puede editarla.
--    Quien ya podía leer el perfil (la persona, su secretaría de distrito, la administración) ve el fondo.
--
--  SIN PÉRDIDA DE DATOS
--    Columna nueva y nula: nadie cambia hasta que elige. El frontend funciona antes de aplicarla (usa el automático
--    y avisa si alguien intenta elegir).
--  Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fondo SMALLINT;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_fondo_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_fondo_chk CHECK (fondo IS NULL OR fondo BETWEEN 1 AND 7);
  END IF;
END
$chk$;

-- Reversa: ALTER TABLE public.profiles DROP CONSTRAINT profiles_fondo_chk, DROP COLUMN fondo;
