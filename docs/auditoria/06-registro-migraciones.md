# 06 · Registro de migraciones (PDF §13: «registro de migraciones y cambios de base de datos»)

Estado **verificado en producción el 2026-11-08** (proyecto `owfmorjlymoxqrzhadnf`, conector de Supabase, solo lectura salvo 0053–0056 aplicadas con autorización expresa). Fuente: `list_migrations` + comprobación de objetos (`to_regclass`, `pg_proc`, `pg_trigger`), porque las migraciones se aplican **a mano** y el registro de Supabase no es completo.

## Aplicadas y registradas (45)
0001, 0002, 0003, 0004, 0005 (+0005b `trabajos_periodo_id_y_funciones`, 0005c `abrir_gestion`), 0007 (`fechas_unificadas`), 0008 (`guardian_admin_y_permisos`), 0009 (`cierra_lectura_anon_roles`), 0010 (`revocar_public_en_funciones_trigger`), 0012 (`storage_avatars`), 0013 (`escritura_gestion`), 0014 (`hay_gestion_abierta`), 0015 (`rubrica_v2`), 0016, 0017, 0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0030, 0031–0036, 0040–0044, 0050–0052, **0053, 0054, 0055, 0056 y 0053b** (aplicadas el 2026-11-09 UTC, en ese orden).

## Aplicadas sin registro (verificadas por sus objetos)
| Migración | Evidencia |
|---|---|
| 0018 `actividades` | existen `actividades` y `etiquetas`; es prerrequisito de 0024 (aplicada) |
| 0015_seed_perfiles (datos) | `perfiles_rol` tiene 6 filas y `criterios_v2` 33 |
| 0011 (documental, sin SQL) | no hay nada que ejecutar |

## Correcciones posteriores
- **0059 `evaluaciones_versiones_uuid`** (2026-11-11, **pendiente de aplicar en producción**): 0053 declaró `evaluacion_id` y `p_id` como BIGINT pero `evaluaciones.id` es UUID; publicar una evaluación fallaba («column evaluacion_id is of type bigint but expression is of type uuid») y rectificar/retirar no encontraban la función. Guardar borradores no fallaba. Prueba: `tools/pruebas/sql-0059.mjs` (reproduce el defecto con id UUID y comprueba el arreglo). El stub de las demás pruebas sigue con id BIGINT: por eso 0053 pasó sus pruebas.

## Pendientes a propósito
- `0006_gestion_miembros.PENDIENTE.sql`: `gestion_miembros` **no existe**. Reescribe 5 funciones y 5 políticas y exige cambios de front en el mismo despliegue.
- `0015_seed_perfiles.PENDIENTE.sql`: ya hay datos (ver arriba); revisar antes de reaplicar.
- Huecos de numeración en el repo (0027–0029, 0037–0039, 0045–0049): no hay archivos, no son migraciones perdidas.

## Objetos de producción relevantes (verificados)
41 tablas, **todas con RLS**; 4 trabajos de pg_cron (`notif_enviar`, `notif_recordatorios`, `notif_recordatorios_equipos`, `notif_mantenimiento`); 3 Edge Functions activas (`enviar-notificaciones` v13, `auth-correo` v6, `gafete-wallet` v1); `credenciales` eliminada (0002).

## Cómo cambiar la base desde ahora
1. Archivo nuevo `supabase/migrations/00NN_descripcion.sql` con cabecera (qué hace / qué no cambia / dónde aplicar) y **bloque de reversa** al final.
2. Prueba `tools/pruebas/sql-00NN.mjs` (PGlite con RLS real; con **paridad**: aplicarla no cambia resultados existentes) y se añade a `npm run sql`.
3. `node tools/pruebas/cadena.mjs` aplica TODA la cadena en orden: debe seguir verde.
4. PR → aplicar en producción con el conector (`apply_migration`) o a mano en el SQL Editor, **después de comprobar la huella de los datos** (conteo + `md5` de las columnas que no deben cambiar) antes y después.
5. Anotarla aquí.
