# Auditoría de arquitectura — EIGHT CREATORS LABs (fases 1 y 2 del PDF, solo diagnóstico)

Fecha: 2026-11-07 · Base: `origin/main` @ `7e1057d` · Rama: `auditoria/arquitectura` · Documento guía: `Auditoria_y_hoja_de_ruta_Eight_Creators_Labs.pdf` (v1.0).
**No se modificó código de la app ni migraciones.** Nada de identidad visual (paleta, tipografías e iconos intactos; `node tools/contraste.js`: 172 pares, sin fallos).

| Entregable | Archivo |
|---|---|
| 1. Mapa de arquitectura actual y propuesto | [01-mapa-arquitectura.md](01-mapa-arquitectura.md) |
| 2. Matriz de funcionalidades y permisos por perfil | [02-matriz-funcionalidades-permisos.md](02-matriz-funcionalidades-permisos.md) |
| 3. Matriz de reglas de negocio y fórmulas | [03-matriz-reglas-formulas.md](03-matriz-reglas-formulas.md) |
| 4. Clasificación de cada punto del PDF con evidencia | [04-clasificacion-pdf.md](04-clasificacion-pdf.md) |
| 5. Hallazgos confirmados, riesgos y plan priorizado | [05-hallazgos-y-plan.md](05-hallazgos-y-plan.md) |
| 6. Registro de migraciones (estado real en producción) | [06-registro-migraciones.md](06-registro-migraciones.md) |

## Estado en producción (verificado y actualizado el 2026-11-08)

Con el conector de Supabase ya apuntando a «eight coms» (`owfmorjlymoxqrzhadnf`): consultas de solo lectura primero y después, con autorización expresa del usuario, **aplicadas las migraciones 0053, 0054, 0055 y 0056 (más `0053b`: `search_path` de `_eval_estado_json`)**. Comprobado después: 49 evaluaciones con la **misma huella** antes y después (nada cambió), las tres tablas nuevas con RLS y sin permisos de cliente, ninguna función nueva ejecutable por `anon`, 4 triggers en `evaluaciones`/estadísticas/personas/períodos/gestiones/distritos, y las 4 migraciones registradas. Hallazgos cerrados con datos reales: B-01 (la política viva ya incluye `gestion_escribible`), H-06 (0 evaluaciones huérfanas hoy; el riesgo latente sigue porque las FK apuntan a `auth.users`), B-05 **confirmado** (`eval_dist_read` deja a cualquier autenticado leer evaluaciones de distrito publicadas: decisión de negocio). Dato nuevo: `evaluaciones.periodo_id` es `ON DELETE CASCADE` (no RESTRICT): borrar un período borra sus evaluaciones; la guardia de 0053 deja pasar los borrados en cascada y 0055 registra el borrado del período.

## Lo que NO se pudo verificar (leer antes de fiarse del resto)

- **La base de datos en vivo.** El proyecto Supabase `owfmorjlymoxqrzhadnf` ("eight coms") **no aparece** entre los proyectos visibles para el MCP de Supabase de esta sesión (`list_projects` devuelve otros tres) y `execute_sql`, `list_migrations` y `list_edge_functions` sobre ese id respondieron «You do not have permission». Por eso **no hay lectura de `pg_policies`, RLS reales, `get_advisors`, migraciones aplicadas ni Edge Functions desplegadas.** Todo lo de base de datos es el resultado de aplicar `supabase/migrations/` en PGlite. La sección D de `05` trae las consultas de solo lectura para cerrar esto en el SQL Editor.
- Despliegue real en Vercel, correo en modo producción, pg_cron, Google Wallet.
- Rendimiento y móvil en dispositivo (solo simulador).
- La rama `claude/amazing-moser-2f695c` no se usó como base ni como fuente de hallazgos (solo se confirmó que existe).

## Pruebas base (ejecutadas en esta sesión, Windows, Node v24.19.0, PGlite)

| Grupo | Resultado |
|---|---|
| `sql-0015` … `sql-0026`, `sql-0030` … `sql-0036`, `sql-0025 --con-equipos`, `sql-0040` … `sql-0044`, `sql-0052` | todas 0 fallidas (ej.: 0031: 66 · 0032: 81 · 0033: 73 · 0035: 31 · 0040: 127 · 0043: 44) |
| `sql-0050`, `sql-0051`, `front-reporte-general` | 77 / 32 / 71, 0 fallidas |
| `cadena.mjs` (anon solo ejecuta lo permitido) | 15, 0 fallidas |
| `correo.mjs` | 108, 0 fallidas |
| `front`, `front-rediseno`, `front-equipos`, `front-estadisticas`, `front-distritos`, `front-manual`, `front-desempeno`, `front-gafete`, `wallet`, `iconos` | 0 fallidas (front-rediseno: 330) |
| `node tools/contraste.js` | 172 pares, sin fallos |

**Actualización:** `npm run todo` ahora usa `tools/pruebas/correr.mjs` (cada script por separado). Última corrida en la rama: 45 scripts, 0 fallidas.

**Fallo de herramienta, no de pruebas (ya resuelto con ese runner):** `npm run todo` (encadenado) aborta con `EXIT 127` y `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` tras `sql-0026`. Al ejecutar los scripts uno a uno pasan todos. Documentado como H-11. No se corrió el simulador de UI (`npm run ui`) ni mediciones responsive.

## Resumen de hallazgos

- **Crítico confirmado (H-01):** una evaluación publicada se puede editar sin versión, motivo ni historial (política `FOR ALL` de admin y ningún trigger que mire `OLD.estado`).
- **Alto confirmado:** dos motores de cálculo y niveles inconsistentes (clásica 26/20/11 de 30, v2 87/67/37, distritos 24/17/10 de 28; la clásica cuenta un criterio sin puntuar como 0) (H-02); no existe Centro de auditoría y hay huecos de trazabilidad (H-03).
- **Medio:** Instagram sin valor anterior ni cierre y con borrado de la captura previa (H-04); cobertura de evaluación no visible (H-05).
- **Hipótesis (necesitan la base viva):** huérfanos al borrar personas (H-06), estado real de migraciones y scripts `fix-*.sql` sueltos (H-07), `eval_dist_read` abierta a todos (B-05).
- **Bien resuelto (no tocar):** motor v2 + tareas en SQL, tareas/equipos/notas con historial append-only, seguridad por triggers y RPC, notificaciones, gafetes, manuales privados.

## Cierre de la fase de arquitectura (2026-11-08)

**Hecho:** los 5 entregables del prompt + el registro de migraciones (06); pruebas base y ampliadas (50 scripts, ~2400 aserciones); intervenciones #1a, #2, #3, #4, #5a, #5b, parte de #9, H-04, H-05, H-08, H-11 implementadas, fusionadas (PR #1–#3) y **0053–0056 aplicadas en producción** con huella de datos idéntica; recorrido completo de las pantallas de los tres perfiles con el servidor **demo** sin login.
**Documentos 01–03:** son la FOTO del diagnóstico (antes de las intervenciones); el estado vigente está en CLAUDE.md, 04, 05 y 06.
**Pendiente, sin bloquear el diseño:** decisiones de negocio (B-05 ranking de distritos público o no, peso de tareas 20 % provisional, zona horaria, estados validada/cerrada de Instagram, alertas por correo/campana, umbrales de puntuaciones atípicas); activar la protección de contraseñas filtradas en Auth; #6 (precisar reglas de tareas colectivas, depende del comité), #7 (identidad visual: espera Canva), #8 (paginación y acciones masivas con vista previa), #10 (móvil en dispositivo real), alertas por correo.
