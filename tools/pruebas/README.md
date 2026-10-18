# Pruebas de migraciones y UI

El sitio no tiene build ni `npm` y esto no lo cambia: esta carpeta es **solo para
desarrollo**. Tiene su propio `package.json` y no se despliega con nada (nadie la enlaza).

```bash
cd tools/pruebas
npm install
npm run todo      # SQL (0015 y 0016) + helpers de core/rubrica.js
npm run ui        # sitio real en http://localhost:3100 con un Supabase simulado (otra sesión puede estar usando ese puerto: `node ui/server.mjs <raíz> <puerto>`)
```

## Qué prueba cada cosa

| Archivo | Qué ejecuta | Cuántas |
|---|---|---|
| `sql-0015.mjs` | La migración `0015_rubrica_v2.sql` y su seed, en un Postgres real (PGlite): **solo períodos nuevos** (los existentes quedan legacy y bloqueados), suma de pesos = 100, perfiles inmutables, validación 1–5, perfil fijado por el servidor, versionado, `resultados_periodo` (núcleo, técnico, percentil con empates, regla de roles pequeños, visibilidad por rol, rechazo sin sesión) y el clonado de `abrir_gestion` | 58 |
| `sql-0016.mjs` | `0016_tareas.sql` con roles reales (`SET ROLE authenticated/anon`) para que **la RLS cuente**: **solo períodos v2** (sin copiar trabajos viejos), quién asigna a quién, quién ve qué, transiciones, que nadie apruebe lo suyo, prórrogas con motivo, historial append-only, entrega inmutable tras entregar, bloqueo, borrado, gestión archivada, resumen de evidencia, zona horaria | 79 |
| `sql-0021.mjs` | `0021_roles_preferencias.sql`: textos del rol, roles **permitidos** (solo la administración los escribe), **preferencias** que no conceden nada y exigen un predeterminado habilitado, rol y actividad en la tarea (la secretaría no puede salirse de lo permitido, la administración sí y queda marcado), historial del cambio de rol, `personas_asignables` filtrado por permisos, y que lo anterior se conserve | 82 |
| `sql-0024.mjs` | `0024_actividades_alcance.sql`: alcance equipo / distrito / selección, quién ve qué (el resto del distrito **no** ve una selección ajena), `guardar_actividad` para administración y secretaría, avisos solo a quien corresponde (con las funciones reales de 0019), compatibilidad con clientes anteriores y aplicación sin 0019 | 54 |
| `sql-0025.mjs` | `0025_seguimiento_bienvenida.sql`: `seguimiento_global` (administración todo, secretaría su distrito, miembro su fila, borradores ocultos), `reporte_actividades` con numerador y denominador, y el asistente de bienvenida (perfil fijado por el servidor, existentes omitidos) | 62 |
| `sql-0031.mjs` | `0031_equipos.sql`: crear/editar equipos solo la administración y solo en PE v2, nombre único por PE, **sin integrantes duplicados** (función e índice), elegibilidad (aprobado, no admin, participa en el PE), ámbito de distrito y excepción con motivo, **alertas en vez de cambios silenciosos** al cambiar de distrito o dejar de participar, retiro con motivo e historial, reincorporación, quién ve qué (miembro, secretaría, anónimo), estados y archivado, gestión archivada | 66 |
| `sql-0032.mjs` | `0032_tareas_equipo.sql`: **una sola fila** para el equipo, participantes al crear, quién asigna (admin; secretaría solo su ámbito), quién la ve, transiciones persistidas, quién entregó fijado por el servidor, aportes firmados por quien llama, prórroga con motivo, altas/bajas con tareas abiertas, anular/bloquear/reabrir, archivar con tareas abiertas | 81 |
| `sql-0033.mjs` | `0033_calificaciones.sql`: valores iniciales de las reglas por PE, quién las edita, peso (la tarea propia pesa 1), nota original/actual, corregir/anular/restaurar con justificación, historial completo con ponderaciones, nota individual dentro del grupo (y que otros no la vean), una tarea con historial no se borra | 73 |
| `sql-0034.mjs` | `0034_calificacion_tareas.sql`: la fórmula ponderada a mano (50.0, no 60), qué cuenta y qué no (pendiente, vencida, anulada, nota anulada), iniciativa propia, mínimo de tareas, colectiva una vez por persona con su multiplicador, quién cuenta al entrar/salir, visibilidad y que las funciones internas no sean llamables | 36 |
| `sql-0035.mjs` | `0035_resultados_integrados.sql`: **la prueba de la causa raíz** (una tarea aprobada llega al resultado individual), perfil = seguimiento = administración, corregir/anular se refleja al instante, peso 0 = resultado de siempre, tarea colectiva, visibilidad y que las anuladas no cuenten | 31 |
| `sql-0036.mjs` | `0036_equipos_vistas.sql`: listado por rol, avance, tareas visibles, resultados del equipo (cada tarea una vez), alertas solo para quien gestiona | 25 |
| `sql-0025.mjs --con-equipos` | La misma prueba de 0025 con 0031–0035 aplicadas **sobre datos que ya existían**: los resultados no cambian, la nota original se conserva, los PE anteriores quedan en peso 0 | 66 |
| `front-equipos.mjs` | Cableado de equipos/evaluación en las tres portales (orden de scripts y CSS, CSP), acciones registradas, sin hex, API, punto de montaje del perfil, razones cubiertas, **escape de HTML** y botones por perspectiva | 58 |
| `sql-0040.mjs` | `0040_notificaciones_integral.sql` sobre avisos históricos reales de 0019 (renombres, estados, ref): catálogo, `notif_encolar` validado (audiencia, lista blanca, requeridas, duplicados), `notif_emitir`, disparadores con los tipos nuevos (a quién llega y a quién NO), reclamar/marcar (omitidos por preferencia o sin correo, arrendamiento, idempotencia, modo prueba = `simulado`), reintentos con espera creciente y tope, campana (categoría, destino, contador, privacidad), preferencias esenciales/opcionales todo-o-nada, estado de envíos solo admin | 127 |
| `sql-0041.mjs` | `0041_avisos_equipos_calificaciones.sql` de extremo a extremo sobre el esquema REAL de 0031–0036 con RLS: incorporación/retiro, tarea colectiva (asignar, prorrogar, instrucciones, responsable, entrega, devolución, aprobación, corrección de nota, nota individual), sin duplicados con los avisos individuales, quien salió ya no es audiencia, recordatorios de equipo, un fallo de avisos nunca rompe la operación, privacidad | 37 |
| `correo.mjs` | Lógica de envío (`nucleo.mjs`): modos (apagado por defecto), escape y enlaces, plantillas ↔ catálogo ↔ campana sin desincronizarse, modo prueba (nunca al destinatario real), errores transitorios/permanentes, «salió pero no confirmó», dos ejecuciones simultáneas, preferencias, puente de Apps Script. **Proveedor simulado: no prueba la entrega real por Gmail** | 108 |
| `sql-0050.mjs` | `0050_reporte_general_pe.sql` (reporte general de todos los PE): una fila por PE incluidos los vacíos, cada cifra = la fuente (`seguimiento_global`, `resultados_periodo`, `resumen_tareas_periodo`), sin duplicar personas (aun con varias relaciones de rol), permisos (admin / secretaría / miembro / anon), filtros de distrito y rol que no amplían lo visible, gestión sin PE, solo lectura; y el consolidado del front sobre las filas reales | 77 |
| `sql-0051.mjs` | `0051_reporte_general_equipos.sql` sobre la cadena 0015–0036: tareas colectivas contadas UNA vez (no por integrante), personas en dos equipos una vez, anuladas fuera de los totales, resultado integrado leído de la fuente, regla del PE, permisos de `equipo_visible()` y filtros | 32 |
| `front-reporte-general.mjs` | `core/reporte-general.js`: cableado y seguridad del marcado, promedio ponderado vs promedio de promedios, porcentaje Σ÷Σ, dos escalas sin mezclar, PE sin datos, filtros/orden, CSV (columnas, TOTAL, neutralización de fórmulas) y las colectivas | 71 |
| `front.mjs` | Los helpers de presentación de `core/rubrica.js` (niveles, perfil vigente, criterios aplicables, HTML escapado, rankings) y que los ids/acciones del HTML nuevo existan | 47 |

`base-eq.mjs` (pruebas 0031–0036) monta el esquema mínimo + las migraciones previas **imitando los permisos por defecto de Supabase**: lo que se crea nace con `GRANT` y cada migración debe `REVOKE`; así una función interna que el cliente pudiera llamar hace fallar la prueba.

`stub.sql` **no es el esquema real**: reproduce lo mínimo que 0015 y 0016 necesitan de
las migraciones anteriores. Si cambias una función de la que dependen (`is_admin`,
`get_district_member_ids`, `gestion_escribible`…), actualiza el stub.

## La UI con backend simulado

`ui/server.mjs` sirve el repo real con los mismos headers de `vercel.json` (CSP
enforcing incluida: un `onclick` inline o un script de otro origen fallaría aquí igual
que en producción) y sustituye únicamente `supabase-client.js` por
`ui/fake-supabase-client.js`, un motor en memoria con datos de ejemplo.

La bienvenida: `?bv=1` (persona nueva, se abre sola), `?bv=2` (a medias, para retomar), `?bv=0` (todas omitidas). El valor queda en `sessionStorage`: pásalo explícito al cambiar de persona.

Entra con `?as=`: `admin.html?as=admin`, `secretario.html?as=sec`, `user.html?as=m1`
(`m1`…`m5` fotógrafos, `r1`…`r3` redactores). El simulador implementa las fórmulas de
`resultados_periodo` y las transiciones de tareas **para que la UI tenga algo que
pintar**; las reglas de verdad las prueban los `sql-*.mjs`. Para ver cómo se comporta
el frontend desplegado antes que el SQL, borra una tabla del simulador desde la consola
(`delete __FAKE.DB.tareas`) y recarga la pestaña.


## Nota sobre Windows

`sql-0026.mjs` (y a veces otras) termina con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` al salir: es un fallo de PGlite/libuv **al cerrar el proceso**, posterior a los resultados, que corta una cadena `&&`. Para una corrida completa ejecuta cada archivo por separado (`for f in sql-*.mjs; do node $f | tail -1; done`).

## Pruebas manuales hechas con el simulador (no automatizadas)

`admin.html?as=admin` → Equipos (lista, reglas del PE, detalle, aprobar una tarea del equipo); `user.html?as=m1` → Mi perfil
(«Cómo se compone tu evaluación», el anillo ya incluye la nota de tareas) y Entregas (Mis equipos + tareas de equipo).
