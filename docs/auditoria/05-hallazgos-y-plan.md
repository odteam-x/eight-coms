# 05 · Inconsistencias confirmadas, riesgos pendientes y plan priorizado

Cada hallazgo: **problema · causa · evidencia · impacto · propuesta · ¿migración?**. «Confirmado» = verificado en el código/migraciones y, cuando aplica, con la prueba que lo demuestra o su ausencia. «Hipótesis» = depende de la base en vivo, que **no se pudo consultar** en esta sesión.

## A. Inconsistencias CONFIRMADAS

> **Avance 7-nov-2026:** H-01 implementado en rama (migración `0053`, `API.guardarEvaluacion`, tests `sql-0053`/`front-rectificacion`). **Pendiente de aplicar en producción** (a mano en el SQL Editor, después de 0052) y de revisión del usuario. Falta aún mostrar el historial de versiones en pantalla (irá con la pantalla de Auditoría, 5b).

### H-01 · Una evaluación publicada se puede editar o borrar sin versión, motivo ni rastro — **CRÍTICA** (PDF §3, §5.4, §6.5)
- **Problema:** nada impide a la administración cambiar puntajes de una evaluación ya publicada; los reportes cambian y la persona solo recibe un aviso sin valores.
- **Causa:** `evaluaciones` tiene `estado CHECK IN ('borrador','publicado')` y la política `evaluaciones_admin` es `FOR ALL` (admin). Los triggers de `evaluaciones` (`evaluaciones_validar_modelo`, 0015→0020→0023) validan el contenido pero **no comparan `OLD.estado`**; los únicos `OLD.estado` del repo están en `tareas` (`0016_tareas.sql:233,255,276`). `API.upsertEvaluacion` hace `upsert` por `(periodo_id,evaluado_id)` (`api.js:424`).
- **Evidencia:** `0005_gestiones.sql:199-203`; `0015_rubrica_v2.sql:317-330`; búsqueda en migraciones/front de `rectific`, `evaluaciones_historial`, `evaluaciones_versiones`: sin resultados. Lo único que existe es el aviso `calificacion_cambiada` del trigger `notif_evaluacion` (0019:233, AFTER INSERT OR UPDATE).
- **Impacto:** viola «sin modificaciones silenciosas» y «motivo, responsable, fecha». Cualquier reporte ya consultado o exportado puede quedar inconsistente.
- **Propuesta:** estados `rectificada` (o versión numérica) + tabla `evaluaciones_versiones` (puntajes, respuestas, `perfil_id`, resultado calculado, responsable, fecha, **motivo ≥ 5**) + trigger que bloquee `UPDATE` de una publicada salvo mediante una RPC `rectificar_evaluacion(id, puntajes, motivo)`; `resultados_periodo()` sigue leyendo la versión vigente. El modelo ya existe para notas de tareas (`calificaciones_historial`, 0033): reutilizar el patrón.
- **Migración:** **sí** (tabla + trigger + RPC; reversible). Requiere test de paridad: ningún resultado publicado cambia al aplicarla (patrón de `sql-0025 --con-equipos`).

> **Avance 7-nov-2026:** 1a hecha (`core/niveles.js`, c410f09) y D-1 resuelto: distritos pasa a 87/67/37 % de 28. Quedan de H-02 la clásica en JS (D-2) y `MAX_TOTAL()` (D-4).

### H-02 · Dos motores de cálculo y tres escalas con cortes distintos — **ALTA** (PDF §6.1, §6.2)
- **Problema:** v2 + tareas se calculan en SQL; la rúbrica clásica y el ranking de distritos, en JS; los niveles no coinciden (D-1) y la clásica trata un criterio ausente como 0 (D-2).
- **Causa:** historia del proyecto (la clásica es anterior a `resultados_periodo()`); `NIVELES` (`core/render.js:32`), `NIVELES_V2` (`core/rubrica.js:18`) y `nivel` de distritos (`core/distritos.js:32`) son constantes independientes; `MAX_TOTAL()` depende de `criterios` vivos (D-4).
- **Evidencia:** 03 §1 (F8–F15) y §3.
- **Impacto:** el mismo porcentaje recibe etiqueta distinta según la pantalla (18/28 = Bueno; 18/30 = En proceso); riesgo de divergir si alguien edita una constante.
- **Propuesta:** (a) **sin migración:** un único módulo `core/niveles.js` con las tres tablas, un test que compare equivalentes porcentuales y documente la diferencia si se decide mantenerla; decisión de negocio sobre D-1. (b) **con migración (opcional):** `resultado_clasico(periodo)` de solo lectura en SQL con paridad contra `calcScore` y `calcScorePuntajes` en test; congelar la clásica como histórica.
- **Migración:** (a) no; (b) sí.

### H-03 · No existe Centro de auditoría: los historiales están dispersos y hay huecos — **ALTA** (PDF §2, §9, §10.2)
- **Problema:** hay eventos append-only por dominio (`tarea_eventos`, `tarea_equipo_eventos`, `equipo_eventos`, `calificaciones_historial`, `periodo_calif_config_hist`, `notificaciones_eventos`) pero **ninguna vista global** y **no** se registran: evaluaciones (H-01), evaluaciones de distrito, cambios de privilegios en `profiles` (rol funcional, distrito, aprobado, admin), activación de PE y apertura/archivo de gestión, `estadisticas_distrito` (H-04), eliminación de personas.
- **Causa:** cada módulo resolvió su trazabilidad por separado; `profiles_bloquear_privilegios` solo **impide**, no registra.
- **Evidencia:** 02 §1 («Auditoría»), búsqueda de tablas `*_eventos`/`*_hist*` en migraciones.
- **Impacto:** imposible responder «¿quién cambió qué y por qué?» de forma transversal; cambios de acceso sin huella.
- **Propuesta:** tabla `auditoria_global` (append-only, escribe solo el trigger; actor, acción, tabla, id, antes/después sin datos sensibles, motivo, gestión) + triggers sobre las tablas sin historial + RPC `auditoria_listar(filtros, página)` solo admin; la pantalla *Auditoría* lee además las tablas de eventos existentes por vista UNION (sin copiar datos).
- **Migración:** **sí.** La **pantalla** que solo une los historiales existentes sería posible **sin migración** (parcial, sin los huecos).

### H-04 · Estadísticas de Instagram: sin valor anterior, captura anterior borrada, sin cierre — **MEDIA-ALTA** (PDF §6.8)
- **Evidencia:** `0043_estadisticas_distrito.sql:91` (`est_dist_actualizar` UPDATE directo), flujo de captura «subir nueva y borrar anterior» (`0043:127`); cualquier secretaría del distrito edita la fila compartida; sin columna de estado (validada/cerrada).
- **Propuesta:** `estadisticas_distrito_hist` (valor y `captura_path` anteriores; no borrar el objeto de Storage de una versión referenciada) + estado `enviada/validada/cerrada` con quién valida.
- **Migración:** sí.

### H-05 · Cobertura de evaluación no visible y renormalización implícita — **MEDIA** (PDF §6.3)
- **Evidencia:** 03 D-7. Núcleo y técnico se calculan sobre lo puntuado (`0015:536-548`, `0023`) sin exponer cuántos criterios aplicaban.
- **Propuesta:** exponer `criterios_puntuados / aplicables` (núcleo y técnico) en `resultados_periodo()` y mostrarlo junto al resultado.
- **Migración:** **sí** (cambia el tipo de retorno de una función que leen ≈10 consumidores; hay que `DROP`+`CREATE` y mantener la compatibilidad del front: `API.getResultadosV2` y `seguimiento_global`). Riesgo medio por el número de consumidores.

### H-08 · Documentación desfasada — **BAJA**
- CLAUDE.md copia un CSP con `connect-src https://*.supabase.co`; `vercel.json` real: `connect-src 'self' https://*.supabase.co … form-action 'self'`.
- CLAUDE.md y un comentario de `auth.js:106` citan `portal.html#ir/…`; no existe ese archivo: el enlace real es `user|secretario|admin.html#ir/…` (`supabase/functions/enviar-notificaciones/nucleo.mjs:51-54`). Funciona; solo está mal descrito.
- **Propuesta:** corregir los textos. **Sin migración.**

### H-11 · El encadenado `npm run sql`/`todo` aborta en Windows — **BAJA (herramienta)**
- `npm run todo` terminó con `EXIT 127` y `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` justo después de `sql-0026` (Node v24.19.0, PGlite 0.5.x). Ejecutando cada script por separado **todos pasan** (README). Probable fallo de cierre de handle de Node en Windows entre procesos encadenados, no un fallo de pruebas.
- **Propuesta:** ejecutar los scripts por separado en un runner que no aborte la cadena, o fijar Node LTS. **Sin migración.**

## B. Riesgos pendientes (hipótesis o decisión de negocio)

| ID | Riesgo | Por qué es hipótesis | Cómo cerrarlo |
|---|---|---|---|
| H-00 | **Estado real de la base desconocido.** Esta sesión no tiene el proyecto `owfmorjlymoxqrzhadnf` entre los visibles del MCP de Supabase (solo `xxauugicljcc…`, `hnlhhwululas…`, `ihwkeawkrxnx…`; las consultas al proyecto indicado devolvieron «You do not have permission»). | Falta de acceso | El usuario ejecuta en el SQL Editor las consultas de la sección D (solo lectura) o concede acceso al MCP |
| H-06 | Borrar una persona (`API.deleteUserProfile`, `api.js:203`) elimina la fila de `profiles`, pero `evaluaciones.evaluado_id` apunta a `auth.users` (`0011`), no a `profiles`: posible evaluación huérfana invisible en reportes (que unen con `profiles`) pero aún en tabla | depende de FKs vivas | consultar FKs; si se confirma, impedir borrado de personas con evaluaciones (archivar en lugar de borrar) |
| H-07 | Migraciones aplicadas a mano: no hay registro de cuáles están en vivo; huecos 0027–0029, 0037–0039, 0045–0049; dos `0015_*`; `0006` y `0015_seed` PENDIENTES; `fix-*.sql` sueltos en la raíz (B-01) | no verificable | `SELECT` de objetos esperados (sección D) y tabla de control de migraciones |
| B-05 | `eval_dist_read` deja a cualquier autenticado leer evaluaciones de distrito publicadas de todos los distritos, mientras la UI las oculta a secretarías | depende de si el ranking es público | decisión de negocio |
| D-1/D-5/D-6 | niveles de distrito, percentil sin tareas, peso de tareas 20 % «sin confirmar», zona horaria `America/Santiago` | reglas de negocio | decisión del comité |
| H-09 | Rendimiento: `admin.html` carga ~38 scripts síncronos y Chart.js siempre (`admin.html:588-626`); paginación real solo en Personas | sin mediciones | medir en gama media antes de actuar |
| H-10 | Superficies de desempeño duplicadas (Mi perfil→Evolución, Mi desempeño, Todos los períodos, Panel) | decisión de producto | intervención #2 |
| H-12 | Plan de mejora, Bandeja, anomalías, alertas inteligentes, exportaciones programadas no existen | son propuestas del PDF | intervenciones #3, #9, fase 3 |

## C. Plan de cambios priorizado (las 10 intervenciones de §11.1 mapeadas al código)

Leyenda de migración: **NO** = seguro sin tocar la base · **SÍ** = necesita migración · **MIXTO**.

| # | Intervención (PDF) | Estado real hoy | Código/objetos implicados | Dependencias | Migración | Riesgo |
|---|---|---|---|---|---|---|
| 1 | Centralizar cálculo de evaluaciones | v2+tareas **ya** centralizado en SQL; falta clásica, distrito, constantes de nivel y cobertura (H-02, H-05) | `core/render.js`, `core/rubrica.js`, `core/distritos.js`, `admin-panel.js:52`, `resultados_periodo` | decisión D-1; paridad de pruebas | **MIXTO**: 1a niveles en un módulo = **NO**; 1b `resultado_clasico` SQL = SÍ; 1c cobertura = SÍ | 1a bajo; 1c medio |
| 5a | **Versionado y rectificación de evaluaciones** (parte crítica de #5; el PDF la marca «Crítica» en §3 pero lista #5 en quinto lugar) | inexistente (H-01) | `evaluaciones`, `api.js:424`, `admin.js` (*Evaluar*), `notif_evaluacion` | conviene tras 1a; antes de #5b | **SÍ** | alto (toca datos publicados) |
| 5b | Centro de auditoría (global) | inexistente (H-03) | nueva tabla/RPC, triggers sobre `profiles`, `periodos`, `gestiones`, `evaluaciones_distrito`, `estadisticas_distrito`; nueva pestaña admin | 5a (la fuente principal) | **SÍ**; pantalla sobre historiales existentes = NO | medio |
| 2 | Unificar desempeño, evolución, comparaciones | cálculo unificado; superficies duplicadas | `core/desempeno.js`, `core/perfil.js` (Evolución), `core/seguimiento.js`, `admin-panel.js` | decisión de producto; coordinar con #4 | **NO** | bajo-medio (`Notif.DESTINOS`, `_ALIAS_TAB`, manuales) |
| 3 | Bandeja de trabajo para Secretaría | inexistente | datos ya disponibles: `seguimiento_global`, `tareas`, `personas_asignables`; `secretario.js`, `core/inicio.js` (hook `extra`) | ninguna dura; mejor tras #2 | **NO** | bajo |
| 4 | Reorganizar el Panel administrativo | «Requiere atención» ya arriba; 7 gráficos debajo | `admin-panel.js`, `admin-personas.js`, `core/rail.js`, `admin.js:81-97` | #2 (mover gráficos a Desempeño) | **NO** | bajo |
| 6 | Precisar reglas de tareas colectivas | **mayormente hecho** (0031–0036); quedan decisiones (peso 20 %, tardía, zona horaria, vencidas) | `periodo_calif_config`, `core/evaluacion-perfil.js` | decisión de comité | **NO** salvo regla de tardía (SÍ) | bajo |
| 7 | Sistema de diseño global | **bloqueado** por la pizarra de Canva | `marca.css`, `premium.css`, `tools/contraste.js` | referencias de Canva | NO | — (fuera de esta sesión) |
| 8 | Tablas, filtros y acciones admin | filtros por tab existen; sin paginación fuera de Personas; sin acciones masivas | `admin.js`, `admin-personas.js`, `api.js` | #4 | **NO** (paginación sobre RPC existente) / SÍ (acciones masivas con vista previa) | medio |
| 9 | Alertas inteligentes | recordatorios existen; no hay detección de inconsistencias | `core/notificaciones.js`, `notif_tipos`, `admin-personas.js` | #1, #5 (señales fiables) | **MIXTO** (en front sobre `seguimiento_global` = NO; tipo de aviso nuevo = SÍ, una fila en `notif_tipos` + plantilla) | bajo |
| 10 | Experiencia móvil completa | `movil.css` + simulador; sin prueba en dispositivo | `movil.css`, `premium.css`, `tools/pruebas/ui/audit-layout.js` | idealmente después de #7 | **NO** | medio |

### Orden recomendado (justificado)
1. **#1a** niveles/constantes en un solo módulo + decisión D-1 (rápido, sin migración, desbloquea comparabilidad).
2. **#5a** versionado/rectificación (única brecha **crítica** confirmada). Es una migración: va por rama, con test de paridad y respaldo.
3. **#2 + #4** navegación y Panel (sin migración; se hacen juntos porque comparten `rail`, `Notif.DESTINOS`, alias y manuales).
4. **#3** bandeja de secretaría (sin migración).
5. **#5b** auditoría global (tras 5a).
6. **#8, #9, #10**; **#6** cuando el comité decida; **#7** cuando llegue Canva.

### Seguro sin migración (resumen)
#1a, #2, #3, #4, #8 (parcial), #9 (parcial), #10, corrección de documentación (H-08), runner de pruebas (H-11), pantalla Auditoría parcial sobre historiales existentes.
### Necesita migración
H-01/#5a, H-03/#5b (completa), H-04, H-05/#1c, #1b, acciones masivas con vista previa, regla de tardía, y cualquier cierre de H-06 que cambie FKs.

## D. Consultas de solo lectura para cerrar lo no verificable (para ejecutar en el SQL Editor de producción)

```sql
-- 1. Qué tablas tienen RLS y cuántas políticas
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) pol
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;
-- 2. Políticas de evaluaciones y evaluaciones_distrito (¿está eval_dist_read? ¿evaluaciones_admin con gestion_escribible?)
select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('evaluaciones','evaluaciones_distrito');
-- 3. FKs de evaluaciones y tareas
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint where contype='f' and conrelid::regclass::text in ('evaluaciones','evaluaciones_distrito','tareas','profiles');
-- 4. Qué migraciones están aplicadas (objetos esperados)
select to_regclass('public.gafetes') gafetes, to_regclass('public.estadisticas_distrito') est, to_regclass('public.periodo_calif_config') calif, to_regclass('public.equipos') equipos, to_regclass('public.manuales_privados') manuales;
-- 5. Evaluaciones publicadas editadas después de publicarse (indicio de H-01)
select count(*) from public.evaluaciones where estado='publicado' and updated_at > created_at + interval '1 minute';
-- 6. Huérfanos (H-06)
select count(*) from public.evaluaciones e where not exists (select 1 from public.profiles p where p.id=e.evaluado_id);
```
