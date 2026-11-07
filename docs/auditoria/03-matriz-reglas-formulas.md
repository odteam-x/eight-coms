# 03 · Matriz de reglas de negocio y fórmulas (PDF §6)

Objetivo: saber **dónde se calcula cada cosa hoy** (SQL vs JS), qué duplicaciones hay y qué escala usa cada pantalla. Verificado leyendo migraciones y JS; las funciones SQL se ejecutan con datos de prueba en `sql-0015/0023/0034/0035/0050/0051.mjs` (todas verdes). **Sin datos reales** (base viva no accesible).

## 1. Dónde vive cada cálculo

| # | Regla / fórmula | Rúbrica | Dónde se calcula HOY | Archivo:línea | Fuente única |
|---|---|---|---|---|---|
| F1 | Núcleo = media de `(p−1)/4·100` (escala `cinco`) o `p/10·100` (`pesos`) sobre los criterios **puntuados** | v2 | **SQL** `resultados_periodo()` | `0015_rubrica_v2.sql:489`; reescrita en `0023` y `0035` | ✔ |
| F2 | Técnico = Σ peso·pct / Σ peso **solo de los puntuados** | v2 | SQL | idem | ✔ |
| F3 | Individual = 0.6·Téc + 0.4·Núc, mezclado con `nota_tareas` por `w` | v2 | SQL | `0035_resultados_integrados.sql:137` | ✔ |
| F4 | Percentil por rol (empates = posición media; roles <4 personas → percentil := técnico y `rol_pequeno`) | v2 | SQL | `0035:121-122` | ✔ |
| F5 | General = (1−w)(0.4·Núc + 0.6·Percentil) + w·notaTareas | v2 | SQL | `0035:139` | ✔ |
| F6 | `nota_tareas` = 100·Σ(peso_efectivo·puntos/10)/Σ peso_efectivo, reglas por PE (`periodo_calif_config`) | v2 | SQL `calif_puntaje()` | `0034_calificacion_tareas.sql` | ✔ |
| F7 | Redondeo: `ROUND(x, 1)` en cada columna devuelta | v2 | SQL | `0035:135-144` | ✔ (pero ver D-3) |
| F8 | Niveles 87 / 67 / 37 (0–100) | v2 | **JS** `NIVELES_V2` | `core/rubrica.js:18-24` | ✘ constante en JS |
| F9 | Total clásico = Σ puntajes + bono (7×4 + 2 = 30) | clásica | **JS** `calcScore` / `calcScorePuntajes` | `core/render.js:104-109` | ✘ no hay función SQL |
| F10 | Máximo clásico = Σ `criterios.max` **vivos** + 2 | clásica | JS `MAX_TOTAL()` | `core/render.js:70` | ✘ depende de la tabla `criterios` actual |
| F11 | Niveles clásicos 26 / 20 / 11 de 30 | clásica | JS `NIVELES` | `core/render.js:32-37` | ✘ |
| F12 | Clásica normalizada a 0–100 **solo para dibujar** | clásica | JS | `admin-panel.js:52` (`calcScorePuntajes()/MAX*100`) | duplicado de F9 |
| F13 | Distrito: 4 competencias 0–7, total /28 | distrito | **JS** `Distritos.consolidar` | `core/distritos.js:21,32` | ✘ |
| F14 | Niveles de distrito **87/67/37 % de 28** (antes 24/17/10) | distrito | JS | `core/niveles.js` | ✔ definidos junto a F8 y F11 (D-1 resuelto) |
| F15 | Ranking acumulado de distritos (promedio = total ÷ PE evaluados, empates comparten posición) | distrito | JS | `core/distritos.js:46-…` | ✘ (probada en `front-distritos.mjs`) |
| F16 | Variación, tendencia (±3 % de la escala), promedio/mín/máx del equipo, comparaciones | ambas, separadas | JS (agrega valores ya calculados) | `core/desempeno.js:179,522,538` | ✔ no recalcula la fórmula; un test falla si aparece 0.6/0.4 |
| F17 | Porcentajes de cumplimiento (publicadas÷participan, a tiempo÷con plazo…) | — | SQL entrega numerador/denominador; **JS** formatea `pct()` | `core/reporte-equipo.js`, `core/seguimiento.js:86` | ✔ regla Σnum÷Σden |
| F18 | Reporte general de PE (conteos, equipos, tareas, anuladas) | ambas | **SQL** `reporte_general_pe()` (lee `seguimiento_global`) | `0050/0051` | ✔ |
| F19 | Seguimiento por persona×período | ambas | SQL `seguimiento_global()` | `0025` → `0035` | ✔ |
| F20 | «A tiempo» se mide en la **primera** entrega, zona `config.zona_horaria` (def. `America/Santiago`) | v2 | SQL (triggers de `tareas`) | `0016_tareas.sql:30,106` | ✔; zona **por confirmar** |
| F21 | Qué tarea cuenta (aprobada+puntos+no anulada; vencida=0 solo si `vencidas_como_cero`) | v2 | SQL | `0034` | ✔ |
| F22 | Nota colectiva (una por tarea; individual la reemplaza solo para esa persona) | v2 | SQL `calif_items`, `nota_individual_equipo` | `0033/0034` | ✔ |
| F23 | Evaluada «publicada» solo cuenta | ambas | SQL (`estado='publicado'`) y JS (`filter(estado==='publicado')`) | `0015:534`; `api.js:582,601,1049,1077,1135,1211`; `core/distritos.js:48` | ✔ doble filtro (RLS + consulta) |

## 2. Escala que usa cada pantalla

| Pantalla | v2 | Clásica | Distrito | Observación |
|---|---|---|---|---|
| Inicio (`core/inicio.js:75`) | 0–100 | 0–`MAX_TOTAL()` (30) | — | |
| Mi perfil (`core/perfil.js:516`) | 0–100, niveles 87/67/37 | 0–30, niveles 26/20/11; **nunca se mezcla** en gráfico | — | |
| Mi desempeño / Desempeño admin (`core/desempeno.js:296`) | 0–100 | 0–`MAX_TOTAL()`; selector de rúbrica, no se mezclan | — | |
| Seguimiento (`core/seguimiento.js:50`) | 0–100 | 0–`MAX_TOTAL()` o `null` si no hay criterios | — | |
| Panel admin (`admin-panel.js`) | 0–100 (SQL) | **normalizado a 0–100 en JS** | — | para dibujar, mezcla visual de modelos en un mismo gráfico: ver D-2 |
| Evaluar (`admin.js:309,2149`) | `resultados_periodo` | `calcScorePuntajes` | — | |
| Secretaría Distrito (`secretario.js:576-619`) | — | `calcScore` por fila para ranking de personas | 0–28 | ranking de personas clásico en JS |
| Reportes / Reporte general | SQL | SQL (cuenta, no puntúa) | — | promedios ponderados Σ÷Σ, nunca promedio de promedios |
| Ranking de distritos | — | — | 0–28, niveles 24/17/10 | |

## 3. Duplicaciones e inconsistencias de cálculo (confirmadas por código)

- **D-1 · RESUELTO (7-nov-2026, decisión del usuario): distritos usa los mismos porcentajes que la rúbrica por roles (87/67/37 % de 28 = 24,36/18,76/10,36).** Texto del hallazgo original: **Niveles incompatibles entre escalas.** Clásica 26/20/11 de 30 (=86,7 %/66,7 %/36,7 %), v2 87/67/37 (coherente), **distritos 24/17/10 de 28 (=85,7 %/60,7 %/35,7 %)**. El comentario de `core/distritos.js:31` dice «mismos cortes que el resto del sitio», lo cual **no es cierto**: 17/28 = 60,7 % frente a 66,7 % de «Bueno». Un distrito con 18/28 es «Bueno», una persona con 18/30 sería «En proceso». Es un criterio de negocio (¿misma escala porcentual?) y **requiere decisión**. Sin migración.
- **D-2 · Clásica en JS, v2 en SQL.** Dos motores. La clásica no tiene función SQL: `calcScore` suma lo que haya en `puntajes` y trata lo ausente como **0** (`puntajeDe(...) = Number(...) || 0`, `core/render.js:98`). Esto contradice la regla «criterio sin puntuar se excluye, no es cero» **en la rúbrica clásica**. En v2 sí se respeta. (Hecho histórico: la clásica no valida completitud al publicar — la validación de 0015/0020/0023 solo aplica a `modelo='v2'`.)
- **D-3 · Redondeo en cascada.** SQL redondea a 1 decimal; JS promedia esos valores ya redondeados (`core/desempeno.js`, `admin-panel.js:145` con `Math.round`). Un promedio del equipo puede diferir hasta ±0,05 del promedio de valores exactos. Efecto pequeño; **pendiente de decidir** si importa.
- **D-4 · `MAX_TOTAL()` usa los criterios vigentes.** `criterios.max` es editable (CLAUDE.md lo documenta). Si el admin sube un `max` después de un PE clásico, el máximo y el nivel de períodos históricos cambian. Los períodos clásicos nuevos están bloqueados por diseño (v2), así que el riesgo es residual, **pero no hay versión de rúbrica clásica guardada**.
- **D-5 · Percentil sin tareas.** `percentil` ordena por `tecnico`, no por resultado con tareas (`0035:121-139`). Documentado en CLAUDE.md; por tanto un PE con peso de tareas alto puede dar un «general» en el que dos personas con igual percentil difieran solo por tareas. No es error; es una **regla a confirmar**.
- **D-6 · Peso de tareas provisional.** PE nuevos v2 nacen con `peso_tareas = 20 %` «sin confirmar» (`0033`). Decisión de comité pendiente (también en `docs/auditoria-equipos-calificaciones.md`).
- **D-7 · Cobertura de evaluación no se guarda ni se muestra.** Con criterios opcionales sin puntuar, núcleo y técnico se **renormalizan implícitamente** (media/Σpeso sobre lo puntuado) y no existe ni columna ni indicador «criterios evaluados / aplicables» (búsqueda de `cobertura` en `core/`, `admin*.js` y `supabase/`: sin resultados relevantes). PDF §6.3.
- **D-8 · No se guarda el desglose bruto/normalizado/peso aplicado.** `resultados_periodo()` recalcula al leer (decisión deliberada de 0034: «sin caché»). La reproducibilidad depende de que `perfil_criterios` (inmutable si se usó) y `criterios_v2` (editable: `tipo`, `activo`) no cambien. Sin versión de `criterios_v2` por evaluación. PDF §6.1.

## 4. Reglas del PDF §2 y §6 — estado del cálculo

| Regla | Estado | Evidencia |
|---|---|---|
| Solo cuentan publicadas | **Correcto** | `0015:534`, `api.js` (6 sitios), `distritos.js:48`; tests `sql-0015/0025/0050` |
| Clásica y por roles no se mezclan | **Correcto** (con matiz D-2/panel) | selector de rúbrica en Desempeño; `Reporte`: promedios aparte; `modelo` inmutable con evaluaciones (`0015 §8`) |
| Criterio sin puntuar se excluye | **Correcto en v2; defectuoso en clásica (cuenta 0)** | `0023:165`; `core/render.js:98` |
| Nadie aprueba su propia tarea | **Correcto** | `puede_revisar_tarea`, `sql-0016` |
| PE sin participación no aparece | **Correcto** | `API.getPeriodosSinParticipar`, `periodo_participantes.activo`; CLAUDE.md §«Un PE en el que no participaste» |
| Bloqueada ≠ cero; prorrogada conserva original; anulada excluida | **Correcto** | `0016` (`fecha_limite_original`, `bloqueo_motivo`), `0033` |
| Vencida sin entregar = 0 solo si la regla del PE lo establece | **Correcto (apagado por defecto)** | `periodo_calif_config.vencidas_como_cero` |
| Entregada tarde: penalización o etiqueta | **Parcial** | se mide «a tiempo» y se muestra; no hay penalización ni regla configurable de tardía |
| Publicadas inmutables / rectificación con motivo | **Inexistente** | ver 05 H-01 |
