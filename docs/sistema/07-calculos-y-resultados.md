# 07 · Cálculo de resultados

**Regla de oro: el resultado se calcula en la base de datos, en un solo lugar** (`resultados_periodo()`). Ninguna pantalla recalcula nada: el perfil, el panel, el desempeño, el seguimiento, los reportes, el ranking y el gafete **leen** esa misma función. Si la fórmula cambia, todas las pantallas cambian a la vez; si alguna tuviera su propia fórmula, divergirían (ya pasó una vez con la clasificación de niveles).

El resultado **se calcula al leer**: no hay caché ni tabla de totales, así que crear, corregir o anular una tarea o una nota actualiza todo en el acto y no puede duplicarse.

## 7.1 Qué cuenta y qué no

- Solo cuentan las evaluaciones **publicadas** (la administración puede pedir los borradores para previsualizar).
- Un criterio **sin puntuar se excluye** del cálculo; **no vale 0**. El 0 es una puntuación válida.
- Una persona que **no participa** en un PE no tiene resultado en él.
- La rúbrica **por roles** (0–100) y la **clásica** (otra escala) y la de **distrito** (0–28) **nunca se mezclan ni se promedian entre sí**.

## 7.2 Rúbrica por roles: las piezas

### Núcleo (0–100)
Media de los criterios del núcleo **puntuados**, cada uno convertido a porcentaje:
- Escala **por peso** (evaluaciones nuevas): `puntos / 10 · 100`.
- Escala **1–5** (evaluaciones antiguas): `(puntos − 1) / 4 · 100`.

### Técnico (0–100)
Σ (peso · porcentaje) / Σ peso, **solo sobre los criterios puntuados**. Con escala por peso equivale a `Σ puntos · 100 / Σ pesos de los criterios puntuados` (si se puntúan todos, es la suma de los puntos, porque los pesos suman 100).

### Individual (sin tareas) — `individual_eval`
```
individual_eval = 0,6 · técnico + 0,4 · núcleo
```

### Percentil dentro del rol
```
percentil = (posición − 1) / (n − 1) · 100
```
- Se ordena por **técnico** dentro del rol; **los empates usan la posición media**, de modo que el mejor de cada rol llega a 100.
- **Roles con menos de 4 personas evaluadas**: percentil := técnico y `rol_pequeno = true` (las pantallas deben decirlo).
- Para calcularlo hacen falta datos de otras personas del rol que un miembro no puede leer; por eso la función es `SECURITY DEFINER` y **filtra ella misma lo que devuelve** (administración todo; secretaría su distrito; miembro lo suyo).

### General (sin tareas) — `general_eval`
```
general_eval = 0,4 · núcleo + 0,6 · percentil
```

## 7.3 Con tareas

### Nota de tareas (0–100)
```
nota_tareas = 100 · Σ( peso_efectivo · puntos / 10 ) / Σ( peso_efectivo )
peso_efectivo = peso de la tarea × multiplicador de su tipo
```
Detalle de qué tareas cuentan: capítulo 05, proceso 14.

### Mezcla en el resultado
Sea `w = peso de las tareas del PE / 100`, que solo se aplica si la persona **tiene nota de tareas** (o si la regla «sin tareas pierde puntos» está activa):
```
individual = (1 − w) · (0,6 · técnico + 0,4 · núcleo) + w · nota_tareas
general    = (1 − w) · (0,4 · núcleo + 0,6 · percentil) + w · nota_tareas
```
- Si la persona **no llega al mínimo de tareas**, `nota_tareas` es nulo y `w = 0`: **conserva su evaluación pura** (nadie baja por no tener tareas calificadas).
- **Excepción** — regla «sin tareas calificadas se pierden los puntos» = Sí: `nota_tareas = 0` con peso `w` completo.
- El percentil sigue ordenando por **técnico** (no por resultado con tareas). Es una regla a confirmar (D-5 de la auditoría).
- Se devuelven también `individual_eval`, `general_eval`, `tareas`, `tareas_n` y `peso_tareas` (el % que realmente aportan las tareas **a esta persona**: 0 si no hay nota).
- Redondeo: `ROUND(x, 1)` en cada columna.

## 7.4 Dos roles (0062)

Una persona con **segundo rol** tiene **una sola evaluación por período**, con dos conjuntos de puntajes: `puntajes` (núcleo + técnico del rol principal) y `puntajes_rol2` (solo los técnicos del segundo rol, de 0 a su peso en el perfil de ese rol). El perfil del segundo rol (`perfil2_id`) lo fija el servidor al primer guardado con datos.

**Peso de cada rol según las tareas**: el peso de un rol es la **suma del peso efectivo de las tareas que cuentan en el período con ese rol** (`tareas.rol_id`; una tarea sin rol o de equipo cuenta para el principal). Con `peso_total = peso_rol1 + peso_rol2`:

```
w2 = peso_rol2 / peso_total          (solo si hay puntajes del rol 2 y tiene tareas que cuenten)
técnico   = (1 − w2) · técnico_rol1 + w2 · técnico_rol2
percentil = (1 − w2) · percentil_en_rol1 + w2 · percentil_en_rol2
```
Cada percentil compara a la persona **solo con quienes tienen puntajes de ese rol**. Después se aplican las mismas fórmulas de individual y general.

- **Si hay tareas del rol 2 pero falta su evaluación** → `rol2_incompleta = true` y se usa **solo el rol principal** (nunca se rellena con 0); la pantalla lo dice («evaluación incompleta»).
- **Una persona con un solo rol, o sin puntajes del rol 2, da exactamente el resultado de antes** (hay una prueba de paridad en `sql-0062.mjs`).
- Columnas nuevas de `resultados_periodo`: `rol2_id`, `rol2_nombre`, `tecnico_rol1`, `tecnico_rol2`, `peso_rol2`, `rol2_incompleta`.

## 7.5 Niveles

| Escala | Excelente | Bueno | En proceso | Bajo |
|---|---|---|---|---|
| **Por roles** (0–100) | ≥ **87** | ≥ **67** | ≥ **37** | < 37 |
| **Clásica** (de 30) | ≥ **26** | ≥ **20** | ≥ **11** | < 11 |
| **Distrito** (de 28) | ≥ **24,36** (87 %) | ≥ **18,76** (67 %) | ≥ **10,36** (37 %) | < 10,36 |

Los tres cortes de cada escala viven en un solo archivo (`core/niveles.js`); `scoreColor`, `scoreLabel` y `scoreClass` derivan de él. Se pintan con los mismos tokens de color (`--sex … --sba` para relleno y `-txt` para texto): son **cuatro pasos de luminosidad**, no cuatro colores.

## 7.6 Ejemplos con números

**Ejemplo 1 — evaluación sin tareas.** Núcleo puntuado 8, 7, 9, 6, 8 (de 10): porcentajes 80, 70, 90, 60, 80 → **núcleo = 76**. Perfil Fotografía (pesos 30/25/20/15/10), puntos 24, 17, 14, 9, 6 → **técnico = 70**.
`individual = 0,6·70 + 0,4·76 = 42 + 30,4 = 72,4` → nivel **Bueno** (≥ 67).

**Ejemplo 2 — con tareas.** Peso de tareas del PE 20 %. Tareas aprobadas: A (8 puntos, peso 2), B (10 puntos, peso 1), C (6 puntos, peso 1):
`nota_tareas = 100 · (2·0,8 + 1·1 + 1·0,6) / (2+1+1) = 100 · 3,2 / 4 = 80`.
`individual = 0,8 · 72,4 + 0,2 · 80 = 57,92 + 16 = 73,9`.

**Ejemplo 3 — percentil y general.** El rol tiene 5 personas evaluadas y la persona es la 3.ª por técnico: `percentil = (3−1)/(5−1)·100 = 50`.
`general_eval = 0,4·76 + 0,6·50 = 30,4 + 30 = 60,4`. Con tareas: `0,8·60,4 + 0,2·80 = 64,3`.

**Ejemplo 4 — sin tareas, regla «pierde puntos» = Sí.** Mismos datos del ejemplo 1: `nota_tareas = 0` con `w = 0,2` → `individual = 0,8 · 72,4 = 57,9` (frente a 72,4 con la regla apagada).

**Ejemplo 5 — dos roles.** Técnico rol 1 = 70, técnico rol 2 = 60, núcleo = 76. Tareas que cuentan: rol 1 pesa 3 y rol 2 pesa 1 → `w2 = 1/4 = 0,25`.
`técnico = 0,75·70 + 0,25·60 = 67,5` → `individual (sin tareas) = 0,6·67,5 + 0,4·76 = 40,5 + 30,4 = 70,9`.

## 7.7 La rúbrica clásica (períodos antiguos)

- **7 criterios × 4 puntos = 28 + bono de excelencia (0–2) = 30 máximo.**
- El total es la **suma de lo guardado**; un criterio ausente cuenta **0** (a diferencia de la rúbrica por roles; es una inconsistencia conocida, D-2).
- Se calcula **en el navegador** (`calcScore`, `calcScorePuntajes`), no en la base. Para dibujar gráficos mezclados el Panel la normaliza a 0–100 **solo para dibujar**; el puntaje oficial es el de 30.
- El máximo usa los criterios vigentes (`MAX_TOTAL()`); no hay versión guardada de la rúbrica clásica (D-4).

## 7.8 Distrito

`total = CGO + CCT + COM + CEE` (cada una 0–7) sobre **28**. Ranking acumulado: **promedio = total ÷ PE evaluados**, empates comparten posición.

## 7.9 Cosas que se calculan fuera de `resultados_periodo` (y por qué es seguro)

| Cálculo | Dónde | Regla |
|---|---|---|
| Variación entre períodos | Desempeño (cliente) | Último valor menos el del período anterior **con dato**; un hueco no se interpola |
| Tendencia | Mi desempeño | Último frente al promedio de los anteriores; «estable» dentro de ±3 % de la escala |
| Promedio / mín / máx del equipo | Desempeño | Media simple de resultados **publicados** del período; cada persona una vez |
| Porcentajes de cumplimiento | Seguimiento y reportes | **Σ numerador ÷ Σ denominador**, nunca promedio de porcentajes; denominador 0 → «—» |
| Promedios en reportes | Reportes | **Ponderados** (Σ resultados ÷ Σ cantidad), nunca promedio de promedios; rúbricas por separado |

Un test de la base de código falla si aparece la fórmula `0.6/0.4` en `core/desempeno.js`.

## 7.10 Zona horaria y «a tiempo»

«A tiempo» se mide en la **primera entrega**, en la zona horaria de la gestión (`config.zona_horaria`; por defecto `America/Santiago`). **Está por confirmar** con el dueño: una zona equivocada marcaría mal las entregas cercanas a la medianoche.

## 7.11 Decisiones y reglas provisionales

| # | Tema | Estado |
|---|---|---|
| D-3 | El redondeo a 1 decimal se aplica en la base y los promedios del cliente usan valores ya redondeados (diferencia ≤ ±0,05) | A decidir si importa |
| D-5 | El percentil ordena por técnico, no por resultado con tareas | Regla a confirmar |
| D-6 | Peso de tareas de los PE nuevos: 20 % provisional | Decisión del comité |
| — | Tardía: se mide y se muestra, pero **no hay penalización ni regla configurable** de tardía | Pendiente |
| — | Vencida sin entregar = 0 solo con la regla del PE (apagada por defecto) | Configurable |
