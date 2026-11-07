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
