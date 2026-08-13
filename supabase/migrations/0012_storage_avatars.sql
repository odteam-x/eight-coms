-- ══════════════════════════════════════════════════════════════════════
--  0012 — el bucket `avatars` no existía
-- ══════════════════════════════════════════════════════════════════════
--
--  CLAUDE.md decía "Storage bucket: avatars". Verificado contra la base:
--
--    SELECT id, name, public FROM storage.buckets;   →  0 filas
--    storage.objects: rowsecurity = true, 0 policies
--
--  O sea que `API.uploadAvatar()` fallaba siempre, en los tres portales,
--  con "Bucket not found". Y aunque el bucket hubiera existido, RLS está
--  activo en storage.objects sin ninguna policy: nadie habría podido subir
--  nada de todas formas.
--
--  CONVENCIÓN DE RUTA
--  api.js escribe en `${userId}/avatar.${ext}`, así que la primera carpeta
--  del nombre es el uuid del dueño:
--
--    (storage.foldername(name))[1] = auth.uid()::text
--
--  Cada quien escribe solo dentro de su carpeta. La lectura es pública
--  porque getPublicUrl() devuelve una URL sin firmar y las fotos se
--  muestran en el rail y en los rankings.
--
--  LÍMITES EN EL BUCKET, no solo en el cliente
--  admin.js valida tipo y tamaño antes de subir, pero eso es ergonomía:
--  cualquiera puede llamar a la API de storage directamente. El límite de
--  2 MB y la lista de tipos van aquí.
--
--  Idempotente: ON CONFLICT en el bucket y DROP POLICY IF EXISTS antes de
--  cada CREATE, igual que la 0005.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública: getPublicUrl() no firma la URL.
DROP POLICY IF EXISTS avatars_lectura_publica ON storage.objects;
CREATE POLICY avatars_lectura_publica ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Escritura: solo dentro de la carpeta propia.
DROP POLICY IF EXISTS avatars_insert_propio ON storage.objects;
CREATE POLICY avatars_insert_propio ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- upsert:true en la subida hace UPDATE cuando el objeto ya existe, así que
-- sin esta policy cambiar de foto fallaría a partir de la segunda vez.
DROP POLICY IF EXISTS avatars_update_propio ON storage.objects;
CREATE POLICY avatars_update_propio ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS avatars_delete_propio ON storage.objects;
CREATE POLICY avatars_delete_propio ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP POLICY IF EXISTS avatars_lectura_publica ON storage.objects;
-- DROP POLICY IF EXISTS avatars_insert_propio   ON storage.objects;
-- DROP POLICY IF EXISTS avatars_update_propio   ON storage.objects;
-- DROP POLICY IF EXISTS avatars_delete_propio   ON storage.objects;
-- -- Ojo: borrar el bucket borra las fotos ya subidas.
-- -- DELETE FROM storage.buckets WHERE id = 'avatars';
-- COMMIT;
