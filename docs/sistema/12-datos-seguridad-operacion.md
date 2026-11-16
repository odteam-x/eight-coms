# 12 · Datos, seguridad y operación

## 12.1 Arquitectura de despliegue

```
Navegador ──HTTPS──► Vercel (páginas estáticas, cabeceras, reescritura /v/:token)
   │
   └──HTTPS/WSS──► Supabase (proyecto «eight coms»: owfmorjlymoxqrzhadnf)
                      ├─ Auth (cuentas, confirmación, recuperación, hook de correos)
                      ├─ PostgreSQL (tablas + RLS + funciones SECURITY DEFINER + disparadores + pg_cron)
                      ├─ Storage (avatars público de lectura; capturas-distrito privado)
                      ├─ Realtime (postgres_changes)
                      └─ Edge Functions: enviar-notificaciones · auth-correo · gafete-wallet
```

- **Producción = rama `main`** del repositorio `odteam-x/eight-coms`, desplegada por Vercel (proyecto `eight-coms`; dominio `eight-coms.vercel.app`). Cada PR genera una vista previa.
- **Sin compilación**: los scripts son clásicos (globales), se cargan con `<script defer>`; las dependencias externas (cliente de Supabase, Chart.js, iconos) van **fijadas a versión exacta con hash SRI**. Subir una versión exige recalcular el hash. Los iconos son SVG empaquetados en `core/iconos.js` (sin CDN).
- **Las migraciones se aplican a mano** en el SQL Editor de Supabase, en orden numérico (las sesiones de trabajo no tienen permiso de escritura en la base).

## 12.2 Cabeceras y CSP (vercel.json)

CSP **en modo enforcing**: `default-src 'self'`; `script-src 'self' https://cdn.jsdelivr.net`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`; `img-src 'self' data: https://*.supabase.co`; `connect-src 'self' https://*.supabase.co wss://*.supabase.co`; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`. Consecuencias:

- **Nada se ejecuta desde un atributo HTML ni un `<script>` en línea.** Los clics van por una tabla de acciones (`ACCIONES` en `config.js`, con `data-act`/`data-arg`/`data-arg2`); los cambios y entradas por `data-change`/`data-input` contra una **lista blanca** (`_ACCIONES_SIMPLES`). Un botón nuevo es una entrada nueva en `ACCIONES`, nunca un `onclick`.
- Todo dato de personas va por `escHtml()` antes de `innerHTML`; colores guardados solo por `colorSeguro()`; texto de celdas CSV con neutralización de fórmulas.
- Además: cabeceras de caché para `sw.js` (sin caché), manifest, imágenes y vendor.

## 12.3 Modelo de datos (por dominio)

| Dominio | Tablas principales |
|---|---|
| **Personas** | `profiles` (nombre, correo, `tipo_miembro`, `es_admin`, `distrito`, `rol_id`, `aprobado`, `avatar_url`, fondo), `roles`, `persona_roles`, `preferencias_rol`, `distritos`, `periodo_participantes`, `bienvenida_estado`, `gafetes` |
| **Estructura del año** | `gestiones`, `periodos_evaluacion` (fechas, `modelo`, `activo`, `v2_permitido`), `config` |
| **Rúbrica** | Clásica: `criterios`, `rubrica`. Por roles: `criterios_v2`, `perfiles_rol`, `perfil_criterios` (más los campos de registro dinámicos de 0020) |
| **Evaluación** | `evaluaciones` (puntajes, `puntajes_rol2`, `perfil_id`, `perfil2_id`, `escala`, `estado`, `version`…), `evaluaciones_versiones`, `evaluaciones_distrito` |
| **Tareas** | `tareas`, `tarea_eventos`, `trabajos_entregados` (solo períodos clásicos) |
| **Equipos** | `equipos`, `equipo_miembros`, `equipo_eventos`, `tareas_equipo`, `tarea_equipo_participantes`, `tarea_equipo_aportes`, `tarea_equipo_eventos` |
| **Notas de tareas** | `periodo_calif_config`, `periodo_calif_config_hist`, `calificaciones_historial` |
| **Distritos** | `estadisticas_distrito`, `estadisticas_distrito_hist` |
| **Calendario** | `calendario` (fechas por período), `actividades`, `actividad_destinatarios`, `etiquetas` |
| **Avisos** | `notificaciones`, `notificaciones_eventos`, `notif_tipos`, `notif_preferencias`, `notif_senal` |
| **Soporte** | `auditoria_global`, `banco_imagenes`, `manuales_privados` |

Reglas de datos que cruzan todo:

- **Identidad = `evaluado_id` (UUID)**, nunca el correo.
- **Los puntajes son anidados** (`row.puntajes[clave]`), nunca se esparcen sobre la fila (una competencia llamada `nombre` pisaría los datos de la persona).
- **Historiales append-only**: `tarea_eventos`, `equipo_eventos`, `tarea_equipo_eventos`, `calificaciones_historial`, `periodo_calif_config_hist`, `evaluaciones_versiones`, `estadisticas_distrito_hist`, `auditoria_global`, `notificaciones_eventos`. Los escriben **solo disparadores**; los clientes tienen revocados INSERT/UPDATE/DELETE.
- Todas las tablas tienen **RLS**.
- La tabla `credenciales` (contraseñas en texto plano) **se eliminó** en la migración 0002 y no se debe volver a crear.

## 12.4 Seguridad: cómo se impone

1. **Registro sin privilegios**: el disparador `on_auth_user_created` fija los campos; no se confía en `user_metadata` (el usuario puede escribirlo); solo se lee `nombre`.
2. **Campos privilegiados congelados**: `profiles_bloquear_privilegios` rechaza a cualquiera que no sea administración. (Nunca basta con un `WITH CHECK` de RLS: una política con `WITH CHECK` nulo reutiliza su `USING`.)
3. **Acceso aprobado**: el frontend bloquea con `aprobado === false`; la base mantiene los campos cerrados.
4. **Guardia de administración**: `IF NOT public.is_admin() THEN RAISE`. **Nunca** `auth.uid() IS NOT NULL AND NOT is_admin()` (esa forma invierte la guarda: dejaba pasar a un anónimo; migración 0008).
5. **Permisos de ejecución**: `REVOKE … FROM PUBLIC` además de anon/authenticated (PostgreSQL concede EXECUTE a PUBLIC al crear una función y anon lo hereda). Los disparadores también (0010). **Cinco funciones SECURITY DEFINER siguen siendo ejecutables por anon a propósito** porque las políticas las invocan: `is_admin`, `is_secretario`, `get_my_distrito`, `get_district_member_ids`, `gestion_escribible`. Para un anónimo devuelven `false` / `null` / `[]`. La prueba `cadena.mjs` verifica que **anon solo ejecuta la lista permitida** (`PERMITIDAS_ANON`, que incluye `verificar_gafete` y `hay_gestion_abierta`).
6. **Ninguna tabla se lee sin sesión** (verificado desde fuera con la clave pública).
7. **Funciones que filtran lo que devuelven**: `resultados_periodo`, `seguimiento_global`, `personas_asignables`, etc. son SECURITY DEFINER **y filtran por quien llama** (administración todo, secretaría su distrito, miembro lo suyo).
8. **Gestión archivada = solo lectura** (`gestion_escribible` en las políticas; antes había políticas heredadas con `WITH CHECK` nulo que lo permitían: se eliminaron en 0013).
9. **Almacenamiento**: `avatars` (lectura pública, escritura solo en la carpeta propia, 2 MB); `capturas-distrito` **privado** (políticas por carpeta de distrito, 600 KB, URL firmada de corta vida).
10. **Matriz completa** de permisos por funcionalidad y por tabla: `docs/auditoria/02-matriz-funcionalidades-permisos.md`.

### Brechas y decisiones abiertas de seguridad

- `eval_dist_read`: la base deja leer a todo autenticado las evaluaciones de distrito **publicadas**; la reserva entre distritos la hace solo la pantalla (decisión de negocio).
- Archivos `fix-*.sql` sueltos en la raíz del repositorio, fuera de `migrations/` (uno de ellos recrea una política sin `gestion_escribible`): estado real **no verificable** sin la base viva.
- Activar en Supabase Auth la **protección contra contraseñas filtradas** (pendiente).
- **Huérfanos al borrar personas**: hipótesis por comprobar con la base viva.

## 12.5 Funciones principales de la base (contratos de lectura y escritura)

| Función | Qué hace | Quién |
|---|---|---|
| `resultados_periodo(periodo, borradores)` | **El** resultado: núcleo, técnico, individual, percentil, general, tareas, segundo rol | Filtrada por quien llama |
| `seguimiento_global(gestion)` | Persona × período con estado y hechos de tareas | Idem |
| `reporte_general_pe(gestion, distrito, rol)` | Una fila por PE (lee `seguimiento_global`) | Idem |
| `evaluacion_cobertura(periodo, persona)` | Criterios puntuados de los que aplicaban | Idem |
| `tareas_calificacion_detalle` / `_resumen` | Qué tarea cuenta, cuánto aporta, por qué no | Idem |
| `rectificar_evaluacion`, `retirar_evaluacion`, `evaluacion_versiones` | Corrección con versión | Administración |
| `calif_config`, `calif_config_guardar` | Reglas de calificación del PE | Admin escribe; secretaría lee |
| `corregir_nota_tarea`, `anular_nota_tarea`, `restaurar_nota_tarea`, `nota_individual_equipo` | Correcciones de notas | Admin (y revisor para individual en equipo) |
| `prorrogar_tarea` | Mover plazo con motivo | Revisor / admin |
| `equipo_guardar`, `equipo_cambiar_estado`, `equipo_agregar_miembros`, `equipo_retirar_miembro`, `equipo_integrantes`, `equipos_resumen`, `tarea_equipo_aportar`, `equipo_resultados` | Equipos y tareas de equipo | Según rol |
| `personas_asignables(periodo, rol)` | Quién puede recibir una asignación (con compatibilidad, preferencia y carga) | Admin todas; secretaría su distrito; miembro nada |
| `guardar_preferencias_rol`, `guardar_actividad`, `guardar_preferencias_notif` | Escrituras atómicas | Cada persona / roles |
| `abrir_gestion`, `set_periodo_activo`, `crear_perfil_rol` | Estructura del año | Administración |
| `notif_emitir`, `notif_reclamar`, `mis_notificaciones`, `notif_no_leidas`, `notif_marcar_leida`, `notif_marcar_todas` | Avisos | Internas / la propia persona |
| `obtener_gafete`, `regenerar_gafete`, `revocar_gafete`, `verificar_gafete` | Gafetes | Persona/admin; `verificar_gafete` también anon |
| `auditoria_listar` | Auditoría unificada | Solo administración |
| `bienvenida_guardar`, `bienvenida_reiniciar` | Asistente | Persona / admin |
| `rol_secundario_de`, `personas_con_mas_de_dos_roles` | Dos roles | Interna / admin |
| `hay_gestion_abierta` | ¿Hay gestión abierta? | Pública |

`calif_items` y `calif_puntaje` son **internas** (revocadas a clientes).

## 12.6 Trabajos programados y funciones de borde

| Pieza | Horario / disparo | Qué hace |
|---|---|---|
| `notif_enviar` (pg_cron) | cada 5 min | Dispara la función de envío de correos |
| `notif_recordatorios` | diario 11:00 | Tareas por vencer y actividades de mañana |
| `notif_recordatorios_equipos` | diario 11:05 | Recordatorios de tareas de equipo |
| `notif_mantenimiento` | diario 11:30 | Borra eventos de aviso con más de 90 días (`notificaciones_eventos`) |
| Edge `enviar-notificaciones` | por `notif_enviar` | Arma y envía correos (`CORREO_MODO`: apagado/prueba/produccion) |
| Edge `auth-correo` | hook de Auth | Correos de confirmación y recuperación |
| Edge `gafete-wallet` | botón del gafete | Pase de Google Wallet (sin configurar → 503) |

Secretos de funciones (no van al repositorio ni a un chat): los de correo/Apps Script, `CORREO_MODO`, `CORREO_PRUEBA_DESTINO`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_JSON`.

## 12.7 Migraciones (0001 a 0065)

Estado: **aplicadas por el dueño** (incluidas 0059 a 0064 el 15 de noviembre de 2026). Se aplican a mano, en orden. Cada una es **idempotente**, lleva su cabecera (qué hace / qué no cambia) y su **reversa comentada**.

| Rango | Contenido |
|---|---|
| 0001–0014 | Seguridad de perfiles, borrado de `credenciales`, período activo único, limpieza de políticas heredadas, **gestiones**, fechas unificadas, guardia de administración corregida, cierre de lectura anónima, revocación en disparadores, FK de evaluaciones, bucket `avatars`, escritura por gestión, `hay_gestion_abierta` |
| 0015–0017 | **Rúbrica por roles** (criterios, perfiles, `resultados_periodo`), **tareas**, **puntos por tarea** |
| 0018–0019, 0022 | Actividades y etiquetas; cola de **notificaciones**; campana |
| 0020, 0023 | Criterios y campos dinámicos; **puntuación por peso** |
| 0021, 0024–0026 | Roles permitidos y preferencias; **alcance de actividades**; seguimiento global y bienvenida; etiqueta «Evento» |
| 0030 | Fondo de perfil |
| 0031–0036 | **Equipos**, tareas de equipo, **notas**, calificación de tareas, **resultados integrados**, vistas de equipos |
| 0040–0042, 0057 | Notificaciones integral; avisos de equipos y notas; opcionales por correo (apagados y luego encendidos) |
| 0043, 0054 | Estadísticas de Instagram del distrito y su historial |
| 0044 | Manuales privados |
| 0050–0051 | Reporte general de PE y equipos |
| 0052 | **Gafetes** |
| 0053, 0059 | **Rectificación** de evaluaciones y corrección de `UUID` |
| 0055 | **Auditoría global** |
| 0056 | Cobertura de evaluación |
| 0058 | Banco de imágenes |
| 0060 | Texto largo en tareas |
| 0061 | «Sin tareas, se pierden los puntos» |
| 0062 | **Dos roles por persona** |
| 0063 | Tareas propias **En curso** |
| 0064 | **Sincronización en tiempo real** |
| 0065 | **Nivel de tarea (distrital/regional), tipo de entrega, peso retirado y quién evalúa la iniciativa** (entregada; **pendiente de aplicar** por el dueño) |
| 0070 | **Registro con solicitud** (distrito o invitado externo y hasta 2 roles; se aplica al aprobar) |

Huecos de numeración (0027–0029, 0037–0039, 0045–0049): no hay archivos; **no son migraciones perdidas**. `0006_gestion_miembros.PENDIENTE.sql` y `0015_seed_perfiles.PENDIENTE.sql` quedan pendientes a propósito. `supabase-schema.sql` es una **foto histórica**, no la fuente de verdad.

Cómo cambiar la base desde ahora: ver `docs/auditoria/06-registro-migraciones.md` (archivo nuevo con cabecera y reversa → prueba `sql-00NN.mjs` con paridad → `cadena.mjs` verde → PR → aplicar → anotar).

## 12.8 Pruebas y herramientas

`tools/pruebas/` (se instalan con `npm install` allí). **72 archivos**, más de **2 400 aserciones** a la última auditoría.

- **SQL con PGlite** (Postgres real) como `authenticated` y `anon`, de modo que **la RLS cuenta**: `sql-0015…0065.mjs`. `base-eq.mjs` imita los permisos por defecto de Supabase para que un `REVOKE` olvidado falle. Cada migración tiene **prueba de paridad**: aplicarla no cambia resultados existentes.
- **Cadena completa**: `cadena.mjs` aplica todas las migraciones en orden y comprueba lo que anon puede ejecutar.
- **Frontend**: `front.mjs`, `front-rediseno.mjs` (marcado, acciones, «sin manejadores en línea», reglas visuales prohibidas), `front-equipos`, `front-desempeno`, `front-estadisticas`, `front-distritos`, `front-manual`, `front-tema`, `front-gafete`, `front-sync`, `front-dos-roles`, `front-reglas-tareas`, `front-texto-largo`, etc.
- **Sincronización**: `sync-multisesion.mjs` simula varias sesiones simultáneas.
- **Correo**: `correo.mjs` (catálogo, plantillas y claves coherentes).
- **Contraste**: `node tools/contraste.js` resuelve los tokens de ambos temas y falla bajo 4,5:1 (texto) o 3:1 (relleno/borde/foco); señala colores literales fuera de `:root`.
- **Iconos**: `iconos.mjs` falla si un icono pedido no existe en `core/iconos.js`.
- **Correr todo**: `npm run todo` en `tools/pruebas` (cada script en su proceso, con resumen y un reintento; el encadenado con `&&` se caía en Windows por una aserción de libuv, aunque ninguna prueba fallara: H-11).
- **Simulador (demo)**: `node tools/pruebas/ui/server.mjs . <puerto>` sirve el sitio **real** con un Supabase simulado y datos inventados: `admin.html?as=admin`, `secretario.html?as=sec`, `user.html?as=m1|m5`, `index.html?as=anon` (más parámetros como `?bv=1|2|3`, `?banco=0`, `?rg=…`). Sirve para recorrer pantallas y medir (`audit-layout.js`) sin tocar producción.
- **Capturas del manual**: `tools/capturas-manual.mjs`.
- **Generadores**: `tools/generar-manuales.mjs` (manuales), `generar-correos.mjs` (plantillas), `generar-iconos.mjs`, `generar-favicon.mjs`, `generar-icono-apple.mjs`.

## 12.9 Convenciones para quien desarrolle

- Una acción nueva → entrada en `ACCIONES`. Un dato humano → `escHtml()`. Una pantalla nueva → `.pantalla-cab` + `h1.pantalla-t` y registro en `Sync`.
- **Prohibido** (regla del dueño, vigilada por `front-rediseno.mjs`): barras de acento en un borde de tarjetas/avisos, contornos de neón al pasar el ratón, emojis o medallas como indicadores, **caja con fondo propio dentro de otra caja**, contenedores seguidos sin separación.
- **Dos modelos de rúbrica deben seguir funcionando**: toda rama v2 empieza con `esPeriodoV2(periodo)`.
- **Nunca** una segunda fórmula en JavaScript.
- Cada cambio visual: `contraste.js`, el simulador a 320/390/768/1024/1440/1920 y las pruebas de front.
- Manuales: se edita el **generador**, no el HTML; se vuelven a capturar las imágenes cuando cambia una pantalla.
