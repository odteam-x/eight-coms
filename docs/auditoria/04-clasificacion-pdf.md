# 04 · Clasificación de cada punto del PDF

Referencia: `Auditoria_y_hoja_de_ruta_Eight_Creators_Labs.pdf` (v1.0, 6-nov-2026). Estados (PDF §13): **I** implementado correctamente · **P** parcialmente · **D** defectuoso · **X** inexistente · **V** pendiente de validar (no se pudo comprobar con lo que hay).

Reglas de este documento: cada fila tiene evidencia (archivo:línea, migración, función, prueba). «Tests» = `tools/pruebas`, todo verde en esta sesión (README). **V** aparece sobre todo donde haría falta la base viva (no accesible) o un dispositivo/medición real. Las referencias H-xx / B-xx / D-x remiten a `05`, `02`, `03`. §8 (identidad visual) y §14 quedan **fuera de alcance** por indicación expresa.

## §2 Principios que deben conservarse

| Punto | Estado | Evidencia |
|---|---|---|
| Permisos separados por perfil | **I** | `profiles_bloquear_privilegios` (0001), políticas por tabla (02 §2); `cadena.mjs` y los `sql-00xx` (que ejecutan las migraciones como `authenticated`/`anon`) |
| Seguridad en RLS, no en pantalla | **I** (V en vivo, B-01) | triggers y RPC con guardia `IF NOT is_admin()` (0008); `cadena.mjs` (anon solo `PERMITIDAS_ANON`) |
| Evaluaciones solo cuentan publicadas | **I** | `0015_rubrica_v2.sql:534`; `api.js:582,601,1049,1077,1135,1211`; `core/distritos.js:48` |
| Clásica y por roles no se mezclan | **I** | `periodos_modelo_fijo` (`0015 §8`); selector en `core/desempeno.js`; reportes separan promedios |
| PE sin participación no aparece | **I** | `periodo_participantes.activo`; `API.getPeriodosSinParticipar` |
| Criterio sin puntuar se excluye | **P** | v2 sí (`0023:165`); **clásica cuenta 0** (`core/render.js:98`, D-2) |
| Nadie aprueba su propia tarea | **I** | `puede_revisar_tarea` (0016); `sql-0016.mjs` |
| Cambios sensibles con historial, responsable, fecha, motivo | **P** | sí: `tarea_eventos`, `calificaciones_historial`, `periodo_calif_config_hist`, `equipo_eventos`, `tarea_equipo_eventos`. **No**: `evaluaciones`, `evaluaciones_distrito`, privilegios de `profiles`, activación de PE/gestión, `estadisticas_distrito` (H-01, H-03) |
| Datos y evidencias dentro del alcance de distrito/perfil | **I** (V B-05) | RLS por distrito; bucket `capturas-distrito` privado con políticas por carpeta |

## §3 Diagnóstico y riesgos (hipótesis del PDF → veredicto)

| Riesgo del PDF | Veredicto | Evidencia |
|---|---|---|
| Evaluaciones: escalas/pesos distintos por pantalla | **P — confirmado en parte** | v2: un motor SQL. Clásica y distrito: JS, niveles inconsistentes (D-1, D-2, D-3) |
| Publicación: modificación posterior sin trazabilidad | **D — confirmado** | H-01: `evaluaciones_admin` FOR ALL; ningún trigger de `evaluaciones` mira `OLD.estado` (solo los de `tareas`, `0016:233,255,276`); `upsert` pisa (`api.js:424`); no hay tabla de versiones (búsqueda `rectific`/`evaluaciones_historial`: 0 resultados) |
| Permisos: aislamiento real entre distritos | **I en pruebas / V en vivo** | tests de RLS; estado real de políticas no verificable (B-01, B-05) |
| Desempeño: duplicación de perfil/desempeño/seguimiento | **P** | el **cálculo** no se duplica (todo sale de `seguimiento_global`→`resultados_periodo`); sí se duplican **superficies**: Mi perfil→Evolución, Mi desempeño, «Todos los períodos» (`core/seguimiento.js`), Panel |
| Tareas: estados con consecuencias inequívocas | **I** | `tarea_transicion_valida` (0016), `0033` (anulada), 0034 (qué cuenta); `sql-0016/0033/0034` |
| Equipos: nota colectiva vs aporte individual | **I** | `nota_individual_equipo()`, aportes por persona (0032–0034); `sql-0032/0033` |
| Reportes: comparar rúbricas distintas | **P** | no se promedian (`reporte-general.js`); comparaciones de Desempeño dentro de una rúbrica; **no** hay aviso explícito de cambio de rol/perfil/versión al comparar dos PE (V) |
| Panel admin saturado | **P** | `admin-panel.js`: 7 gráficos (anillo, histograma, comparación, radar, tendencia, mapa de calor, top) tras «Requiere atención» (`admin-personas.js:423`) |
| Calendario: competencia visual | **V** | leyenda filtrable (`core/calendario.js`); sin evaluación de uso |
| Notificaciones: fatiga | **I** | 0042: solo esenciales por correo; dedupe por clave; preferencias; `correo.mjs` |
| Móvil: formularios y tablas cómodos | **P / V** | `movil.css`, tablas→tarjetas <768 px, audit con `tools/pruebas/ui/audit-layout.js` en simulador; **no probado en dispositivo real** |

## §4 Arquitectura de información

| Punto | Estado | Evidencia |
|---|---|---|
| 4.1 Miembro: Inicio / Desempeño / Mis tareas / Calendario / Perfil | **P → resuelto por decisión del usuario: Desempeño dentro de Mi perfil** | `user.js:132-138`: Inicio, Mi perfil, Mi desempeño, Calendario, Entregas. Existen todos; falta separar bien Perfil (datos) de Desempeño (hoy Mi perfil trae Resumen/Criterios/Evolución) |
| 4.2 Secretaría: Inicio con bandeja | **X** (bandeja) | no existe «bandeja»; hay bloque «Tu distrito» en Inicio |
| 4.2 Secretaría: Desempeño del distrito | **X → implementado en rama** | pestaña `desempeno-distrito` (`secretario.js`), reutiliza `core/desempeno.js` |
| 4.2 Mi distrito, Tareas y revisiones, Seguimiento, Reportes, Calendario | **I** | `secretario.js:227-231` |
| 4.3 Admin: Centro de control / Operaciones / Organización / Reportes / Configuración | **P** | `admin.js:81-97`: 10 entradas planas + engranaje (Períodos, Actividades, Rúbrica, Roles, Gestiones). Ya separa operación de configuración; no agrupa por responsabilidad |
| 4.3 Admin: Auditoría | **X → implementado en rama (0055, sin aplicar)** | `core/auditoria.js`, `auditoria_listar()` |
| 4.4 Delimitación Panel/Desempeño/Seguimiento/Reportes/Perfil | **P** | responsabilidades solapadas (01 §2.1) |

## §5 Flujos

| Flujo | Estado | Evidencia |
|---|---|---|
| 5.1 Miembro: entrada, inicio, desempeño | **I/P** | `core/inicio.js`; desempeño duplicado (arriba) |
| 5.1 abrir tarea, entregar, devoluciones | **I** | `core/tareas.js`; entrega exige enlace o nota; `tarea_eventos` conserva historial |
| 5.1 Plan de mejora | **X** | búsqueda «plan de mejora»: 0 resultados |
| 5.2 Secretaría: asignar con validaciones | **I** | `core/asignar.js` (compatibilidad, duplicado, sobrecarga, no participa, fecha pasada) |
| 5.2 Revisión consecutiva sin volver al listado | **X** | revisión por tarjeta/modal individual |
| 5.2 Decisión (aprobar/devolver/prorrogar), seguimiento, reporte distrital | **I** | RPC `prorrogar_tarea`, `seguimiento_global`, `reporte_general_pe` |
| 5.3 Admin: contexto de gestión/PE | **I** | modal de entrada (CLAUDE.md Fase 11), `ec-admin-entrada` |
| 5.3 diagnóstico (Requiere atención) | **I** | `admin-personas.js` |
| 5.3 impacto antes de cambios masivos | **X** | no hay vista previa de operaciones masivas |
| 5.3 evaluar con valores anterior/nuevo y motivo | **X** | H-01 |
| 5.3 auditoría de cambios sensibles | **X** | H-03 |
| 5.4 Registro y aprobación de acceso | **I** | trigger `on_auth_user_created`, `aprobado`, aviso de acceso (0040) |
| 5.4 Publicación: borrador→validaciones→**vista previa→confirmación**→publicación→notificación→**registro inmutable** | **P** | validaciones al publicar (`0023:165-178`) y aviso; vista previa de reglas **V**; registro inmutable **X** |
| 5.4 Corrección de evaluación | **X / D** | edición directa sin motivo (H-01) |
| 5.4 Prórroga de tarea | **I** | `prorrogar_tarea`, `fecha_limite_original` |
| 5.4 Cambio de equipo sin silencio | **I** | evento `alerta` en lugar de cambio automático (0031) |

## §6 Reglas de negocio y cálculos

| Punto | Estado | Evidencia |
|---|---|---|
| 6.1 Motor central único | **P** | v2+tareas en SQL (`resultados_periodo`); clásica y distrito en JS (03) |
| 6.1 Guardar versión de rúbrica/perfil/reglas | **P** | `evaluaciones.perfil_id` (inmutable), `periodo_calif_config`+hist; **no** versión de rúbrica clásica ni de `criterios_v2` (D-4, D-8) |
| 6.1 Reconstruir cómo se obtuvo una nota | **P** | `tareas_calificacion_detalle()` desglosa tareas; evaluación se recalcula al leer, sin desglose guardado |
| 6.1 Distinguir bruto/normalizado/peso/final | **P** | solo para tareas; evaluaciones devuelven núcleo, técnico, individual_eval, general (0035) |
| 6.2 Rúbrica por roles 0–100, anclas 1-3-5 | **I** | `(p−1)/4·100`; niveles 87/67/37 |
| 6.2 Criterio 0–peso o 0–10 | **I** | `evaluaciones.escala` fijada por el servidor (`0023`); `sql-0023` |
| 6.2 Clásica 7×4+2=30 | **P** | JS; bono con `CHECK 0–2`; criterios incompletos=0 (D-2) |
| 6.2 Tareas 0–10 y peso | **I** | `0017`, `0033`, `0034`; peso 1/2/3/5 y reglas por PE |
| 6.2 Perfiles de rol suman 100 | **I** | trigger de restricción diferida (0015) |
| 6.3 No evaluado ≠ cero | **I** (v2) | `!= null` documentado; `0023` |
| 6.3 Criterios obligatorios para publicar | **I** | `0020/0023` (`obligatorio`) |
| 6.3 Documentar y comunicar renormalización | **P → comunicado en rama (0056)** | la nota de cobertura explica que lo no puntuado se excluye |
| 6.3 Cobertura criterios evaluados/total | **X → implementado en rama (0056, sin aplicar)** | `evaluacion_cobertura()`, `EvaluacionPerfil.coberturaHTML` |
| 6.4 Estados de tarea (a tiempo, vencida, bloqueada, prorrogada, anulada, no participa) | **I** | `0016`, `0033`; `sql-0016/0033/0034` |
| 6.4 Entregada tarde: penalización/etiqueta | **P** | medida y mostrada; sin regla configurable |
| 6.5 Estados pendiente/borrador/lista/publicada/rectificada | **P** | solo `borrador`/`publicado` (`CHECK`, `supabase-schema.sql:267`) |
| 6.5 Sin modificación silenciosa tras publicar | **D** | H-01 |
| 6.5 Rectificación con autorización y motivo; versión anterior; efecto en reportes | **X** | H-01 |
| 6.5 Notificar rectificación | **P** | trigger `notif_evaluacion` en UPDATE (0019) emite `calificacion_cambiada`; sin valores (la política de datos lo prohíbe) |
| 6.6 No comparar rúbricas distintas | **I** | selector; `modelo` inmutable |
| 6.6 Identificar cambios de rol/perfil/versión/pesos | **P / V** | chips de rol y versión de perfil en Perfil; Desempeño no advierte (V) |
| 6.6 Períodos sin participación y no publicadas | **I** | «se dice cuántas quedan fuera» (`core/desempeno.js`), `reporte_general_pe` |
| 6.6 Mostrar métrica, población, filtros, n | **I** | numerador/denominador (`core/reporte-equipo.js`, CSV con alcance) |
| 6.7 Colectivo / participación / individual separados | **I** | 0032–0034 |
| 6.7 Altas y bajas en el período; fechas efectivas | **I** | `equipo_miembros` (membresía activa única, nueva fila al re-agregar), `equipo_eventos` |
| 6.7 Evitar reconocimiento idéntico | **I** | `nota_individual_equipo()` con evidencia ≥10; cuenta quien participó **o** aportó |
| 6.8 Instagram: período, distrito, responsable, fecha, evidencia | **I** | 0043 (trigger fija `subido_por`, `actualizado_en`; `captura_path NOT NULL`) |
| 6.8 Conservar valor anterior al corregir | **X → implementado en rama (0054, sin aplicar)** | `estadisticas_distrito_hist` + trigger |
| 6.8 Quién valida/cierra la cifra | **X** | no hay estado validada/cerrada; cualquier secretaría del distrito edita la fila |
| 6.8 Captura reemplazada no elimina trazabilidad | **D → corregido en rama** | `core/estadisticas-distrito.js` ya no borra la anterior; el historial la referencia |

## §7 Recomendaciones por perfil

| Punto | Estado | Evidencia |
|---|---|---|
| 7.1 Inicio simplificado, Desempeño concentrado, Perfil sin segundo panel | **P** | ver 4.1 |
| 7.1 Entrega de evidencia y devoluciones | **I** | `core/tareas.js` (sin archivos: enlace/nota) |
| 7.1 Plan de mejora | **X** | |
| 7.1 Tarea individual vs colectiva clara | **I** | `core/equipos.js`, `Tareas` |
| 7.1 Notificar publicación/rectificación | **I/P** | tipos `calificacion_nueva`, `calificacion_cambiada` |
| 7.2 Bandeja de trabajo | **X** | |
| 7.2 Acciones rápidas desde listados | **P** | calendario, perfil→tarea, buscador Ctrl+K |
| 7.2 Revisión consecutiva | **X** | |
| 7.2 Pendientes por persona y urgencia | **P** | tarjetas con «N por revisar/vencidas», sin bandeja ordenada |
| 7.2 Qué resuelve Secretaría vs Administración | **V** | |
| 7.2 Indicadores de cumplimiento distrital | **P** | Resumen del distrito («Qué falta», `Distritos.montarSecretaria`) |
| 7.3 Reorganizar menú | **X** | 01 §2.2 |
| 7.3 Panel prioriza acciones | **I** | «Requiere atención» primero |
| 7.3 Análisis avanzado fuera de Inicio | **P** | gráficos aún en el Panel |
| 7.3 Vista previa de operaciones masivas | **X** | |
| 7.3 Auditoría global y actividad reciente | **X** | H-03 |
| 7.3 Detector de inconsistencias | **P** | «Requiere atención» cubre accesos, sin evaluar, borradores, entregas, vencidas, no inconsistencias de datos |
| 7.3 Comparar configuraciones entre períodos | **X** | `periodo_calif_config_hist` es por período, sin comparador |

## §9 Funcionalidades nuevas

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Centro de auditoría | **X → implementado en rama (0055, sin aplicar)** | H-03 |
| Bandeja de trabajo | **X** | |
| Plan de mejora | **X** | |
| Alertas inteligentes | **P** | recordatorios de vencimiento/víspera (pg_cron); sin detección de inconsistencias |
| Historial de actividad | **P (rama)** | la pantalla Auditoría lista todas las acciones sensibles; no es un feed por persona/equipo |
| Evaluación asistida (validar completitud y reglas antes de publicar) | **P** | validación en trigger al publicar; sin pantalla previa de cobertura |
| Detección de anomalías | **X** | |
| Gestión masiva con vista previa | **X** | |
| Centro de documentación | **P** | `ayuda/{miembro,secretario,admin}.html` por perfil (admin privado, 0044) |
| Exportaciones programadas | **X** | CSV manual |
| Indicadores de gestión | **P** | `core/reporte-equipo.js` |

## §10 Seguridad, datos y rendimiento

| Punto | Estado | Evidencia |
|---|---|---|
| 10.1 Índices por gestión/período/distrito/persona/rol/equipo/estado | **V** | índices en tareas, equipos, notificaciones, perfiles (01 §1.3); `evaluaciones` solo `UNIQUE(periodo_id,evaluado_id)` + `perfil_id`; sin `EXPLAIN` real |
| Evitar consultas repetidas en un panel | **P** | `Store` + cachés (`PanelAdmin.datos`); no medido |
| Paginación real | **P** | solo `profiles` (`api.js:176-178`); el resto usa filtro por período, y historiales `limit(100/30)` |
| FKs e integridad | **V** | `0011` documenta FK a `auth.users`; `deleteUserProfile` borra `profiles` (`api.js:203`) → posible huérfano (H-06) |
| Prevenir duplicados | **I** | UNIQUE + claves de notificación |
| Transacciones en operaciones multi-registro | **I** | `guardar_actividad`, `equipo_*`, `guardar_preferencias_*` son una sola RPC |
| Conservar versiones de reglas | **P** | perfiles y config de PE sí; rúbrica clásica y `criterios_v2` no |
| 10.2 RLS para CRUD y cruce de distrito | **I** | ver 02 §3 |
| Miembro no altera puntuaciones desde el cliente | **I (V test)** | estructural; sin aserción dedicada |
| Autorización en servidor | **I** | |
| Tokens de gafete | **I** | 96 bits, tabla sin grants, récord público acotado, respuesta uniforme (0052) |
| Evidencias accesibles solo a autorizados | **P** | capturas de distrito privadas (I); bucket `avatars` público por diseño; evidencias de tareas = enlaces externos no controlados (V) |
| Registrar cambios administrativos | **P** | H-03 |
| 10.3 Gráficos y módulos bajo demanda | **X** | Chart.js y ~38 `<script>` síncronos cargados siempre (`admin.html:588-626`) |
| 10.3 Evitar solicitudes duplicadas / caché central | **I/V** | `core/store.js`; no medido |
| 10.3 Imágenes y capturas | **I** | `reducirCaptura()`, logo WebP |
| 10.3 Medir tablas/forms en gama media y móvil | **X** | no hay medición de rendimiento en el repo |
| 10.4 Qué se consulta offline | **I** | decisión explícita: `sw.js` solo cachea `offline.html` e icono |
| No guardar datos sensibles | **I** | idem |
| Operación publicada solo con confirmación del servidor | **I** | no hay escritura offline |
| Sincronización/reintentos | **n/a** | no existe cola offline |

## §11–§13 Plan, criterios, entregables técnicos

| Punto | Estado | Evidencia |
|---|---|---|
| 12.2 Pruebas de roles/permisos | **I** | `sql-*`, `cadena.mjs` |
| 12.2 Evaluaciones: borrador, publicación, excluidos, pesos, redondeo | **I** | `sql-0023`, `sql-0035` |
| 12.2 Evaluaciones: **rectificación** | **X** | no hay función que probar |
| 12.2 Tareas / Equipos / Reportes / Notificaciones | **I** | `sql-0016/0032-0036/0050/0051/0040-0042`, `correo.mjs` |
| 12.2 Períodos: cambio de rol/versión/comparación válida-no válida | **P** | `sql-0015` cubre modelo; sin prueba de aviso de comparación |
| 12.2 PWA y móvil | **P** | simulador + `audit-layout.js`; sin dispositivo |
| 12.2 Rendimiento | **X** | |
| 12.3 Reversión de migraciones | **I/P** | cada migración trae bloque de reversa comentado (p.ej. `0015:796`, `0019:371`, `0023:291`) |
| 12.3 Migraciones «respaldadas y compatibles» | **V** | aplicadas a mano; sin registro de cuáles están en vivo (H-07) |
| §13 Entregables: mapa, matrices, hallazgos, plan | **I** | este directorio |
| §13 Registro de migraciones | **P** | carpeta ordenada; huecos de numeración 0027-0029, 0037-0039, 0045-0049; dos `0015_*`; `0006` y `0015_seed` PENDIENTES; sin tabla de control |
| §13 Pruebas responsive y rendimiento | **P** | responsive en simulador; rendimiento X |
| §13 Documentación y pendientes | **P** | CLAUDE.md extenso pero con partes desfasadas (H-08) |
