# 01 · Mapa de arquitectura — actual y propuesto

Base: `origin/main` @ `7e1057d` (2026-11-06). Verificado leyendo el código y ejecutando las migraciones en PGlite. **La base en vivo no se pudo consultar** (ver README: el proyecto `owfmorjlymoxqrzhadnf` no está entre los proyectos visibles para la herramienta MCP de Supabase de esta sesión). Todo lo de «base de datos» es el estado resultante de aplicar `supabase/migrations/` en orden, no una lectura de producción.

## 1. Arquitectura ACTUAL

### 1.1 Capas

```
Navegador (HTML/CSS/JS clásico, sin build, ~38 <script> síncronos por portal)
  ├─ index.html + login.js + registro.js        acceso / registro (sin sesión)
  ├─ user.html + user.js                        Miembro        (requireRole('miembro'))
  ├─ secretario.html + secretario.js            Secretaría (y miembro con la misma página) (requireAnyRole)
  ├─ admin.html + admin.js (+ 5 archivos admin-*.js)   Administración (requireAuth(true))
  ├─ verificar.html + verificar.js              público, /v/:token (gafete)
  └─ core/*.js (36 módulos compartidos)         presentación + glue; cálculo SOLO en lectura de la base (salvo lo anotado en 03)
Config/infra del cliente: config.js (ACCIONES, escHtml), supabase-client.js (SB), auth.js, api.js (API, 1401 líneas, 65 select),
  sw.js (solo offline.html), manifest.webmanifest, vercel.json (CSP enforcing + rewrite /v/:token)
Supabase: Postgres (RLS + SECURITY DEFINER RPC + triggers), Auth, Storage (avatars público, capturas-distrito privado),
  Edge Functions: auth-correo, enviar-notificaciones, gafete-wallet; pg_cron: notif_enviar (*/5), notif_recordatorios (11:00),
  notif_recordatorios_equipos (diario)
```

### 1.2 Archivos por responsabilidad (solo raíz y `core/`, sin worktrees)

| Responsabilidad | Archivos |
|---|---|
| Acceso | `index.html`, `login.js`, `registro.js`, `registro.html` (redirige), `auth.js` |
| Datos | `api.js` (todas las consultas), `core/store.js` (estado y política de carga por pestaña) |
| Presentación común | `core/render.js` (NIVELES, calcScore, modales, estados), `core/ui.js`, `core/charts.js`, `core/iconos.js`, `core/theme.js`, `core/avatar.js`, `core/fondo.js` |
| Navegación | `core/rail.js` (initNav), `core/buscador.js` (Ctrl+K), `core/notificaciones.js` |
| Perfil / persona | `core/perfil.js`, `core/perfil-pe.js`, `core/personas.js`, `core/cuenta.js`, `core/preferencias.js`, `core/bienvenida.js`, `core/gafete.js` |
| Evaluación | `core/rubrica.js` (presentación v2), `core/evaluacion-perfil.js` (composición + reglas del PE), `admin.js` (formulario *Evaluar*), `admin-criterios.js` |
| Tareas / equipos | `core/tareas.js`, `core/asignar.js`, `core/selector.js`, `core/equipos.js` |
| Lectura analítica | `core/desempeno.js`, `core/seguimiento.js`, `core/reporte-equipo.js`, `core/reporte-general.js`, `admin-panel.js`, `admin-reportes.js` |
| Distritos | `core/distritos.js`, `core/distritos-admin.js`, `core/estadisticas-distrito.js`, `secretario.js` |
| Calendario | `core/calendario.js`, `core/actividad-form.js`, `admin-actividades.js` |
| Solo admin | `admin.js` (2758 líneas), `admin-personas.js`, `admin-panel.js`, `admin-reportes.js`, `admin-actividades.js`, `admin-criterios.js` |

### 1.3 Tablas (resultado de aplicar migraciones; PDF §10)

| Dominio | Tablas |
|---|---|
| Identidad/organización | `profiles`, `roles` (+descripcion/responsabilidades/requisitos), `distritos`, `gestiones`, `gestion_miembros`* (*0006 PENDIENTE, no aplicada), `persona_roles`, `preferencias_rol`, `bienvenida_estado`, `gafetes`, `config` |
| Período y rúbrica | `periodos_evaluacion` (modelo legacy/v2, `activo` único), `periodo_participantes`, `criterios`, `rubrica` (clásica), `criterios_v2`, `perfiles_rol`, `perfil_criterios` (v2) |
| Evaluación | `evaluaciones` (estado borrador/publicado, escala cinco/pesos, perfil_id, respuestas), `evaluaciones_distrito`, `estadisticas_distrito` |
| Tareas | `tareas`, `tarea_eventos`, `trabajos_entregados` (legacy), `calificaciones_historial`, `periodo_calif_config`, `periodo_calif_config_hist` |
| Equipos | `equipos`, `equipo_miembros`, `equipo_eventos`, `tareas_equipo`, `tarea_equipo_participantes`, `tarea_equipo_aportes`, `tarea_equipo_eventos` |
| Calendario | `calendario` (PE), `actividades`, `actividad_destinatarios`, `etiquetas` |
| Notificaciones | `notif_tipos` (20), `notificaciones`, `notif_preferencias`, `notificaciones_eventos` |
| Otros | `manuales_privados` (0044) |
| Eliminada | `credenciales` (0002) |

### 1.4 RPC y funciones (139 `CREATE FUNCTION` en migraciones; 27 distintas llamadas desde el cliente)

Llamadas por el cliente (`.rpc`): `resultados_periodo`, `seguimiento_global`, `reporte_general_pe`, `reporte_actividades`, `resumen_tareas_periodo`, `personas_asignables`, `prorrogar_tarea`, `guardar_actividad`, `set_periodo_activo`, `abrir_gestion`, `hay_gestion_abierta` (anon), `crear_perfil_rol`, `guardar_preferencias_rol`, `guardar_preferencias_notif`, `mis_preferencias_notif`, `mis_notificaciones`, `notif_no_leidas`, `notif_marcar_leida`, `notif_marcar_todas`, `notif_resumen`, `notif_estado_envios`, `bienvenida_guardar`, `bienvenida_reiniciar`, `obtener_gafete`, `regenerar_gafete`, `revocar_gafete`, `verificar_gafete` (anon). Las de equipos y notas (`equipo_*`, `tarea_equipo_*`, `corregir/anular/restaurar_nota_tarea`, `calif_config_guardar`, `nota_individual_equipo`, `equipos_resumen`, `equipo_resultados`, `tareas_calificacion_*`) se llaman desde `core/equipos.js`/`core/evaluacion-perfil.js` mediante el helper `API._rpc()` (`api.js:740`), por eso no salen en un grep de `.rpc(`.

Motor de cálculo en SQL: `resultados_periodo()` (0015→0023→0035) ← `calif_puntaje()` (0034) ← `calif_items()` (0034, interna).
Ayudantes de seguridad (EXECUTE para anon a propósito): `is_admin`, `is_secretario`, `get_my_distrito`, `get_district_member_ids`, `gestion_escribible`.

### 1.5 Políticas RLS (inventario desde migraciones; 65 sentencias `CREATE POLICY`, algunas repetidas o sustituidas entre migraciones)

| Tabla | Política (cmd) | Quién |
|---|---|---|
| `evaluaciones` | `evaluaciones_admin` (ALL), `evaluaciones_read_own_published`, `evaluaciones_read_secretario` (SELECT, definidas en `fix-evaluaciones-visibilidad.sql`, **script suelto fuera de `migrations/`**) | admin todo; miembro la suya publicada; secretaría publicadas de su distrito |
| `evaluaciones_distrito` | `eval_dist_admin` (ALL), `eval_dist_read` (SELECT publicado o admin) | admin; todos ven publicadas |
| `profiles` | `profiles_read`, `profiles_read_secretario`, `profiles_update`, `profiles_insert`, `profiles_delete_admin` + trigger `profiles_bloquear_privilegios` | ver 02 |
| `periodos_evaluacion`, `config`, `criterios`, `rubrica`, `calendario`, `gestiones`, `etiquetas`, `actividades`, `persona_roles` | `*_read` a autenticados; `*_write/admin` solo admin (con `gestion_id_escribible` desde 0013) | |
| `tareas` | `tareas_select/insert/update/delete` + triggers `tareas_validar_*` (el servidor fija estado, `asignada_por`, etc.) | admin / secretaría de su distrito / miembro sí mismo |
| `tarea_eventos`, `tarea_equipo_eventos`, `equipo_eventos`, `calificaciones_historial`, `periodo_calif_config(_hist)` | solo SELECT; escribe el trigger | |
| `equipos`, `equipo_miembros`, `tareas_equipo`, `…participantes`, `…aportes` | SELECT por visibilidad; DML revocado, todo por RPC | |
| `estadisticas_distrito` | 4 políticas por distrito + Storage `capturas_distrito_*` (bucket privado) | secretaría de su distrito; admin |
| `manuales_privados` | SELECT solo `is_admin()` | |
| `avatars` (Storage) | lectura pública, escritura por carpeta propia | |
| Sin políticas para clientes | `gafetes`, `notificaciones`, `notif_preferencias`, `bienvenida_estado`, `preferencias_rol`… : solo vía RPC SECURITY DEFINER | |

### 1.6 Edge Functions y tareas programadas

| Pieza | Función | Estado |
|---|---|---|
| `auth-correo` | hook de correos de Auth; responde 200 y envía en segundo plano | en repo; despliegue **no verificable** |
| `enviar-notificaciones` | envía cola `notificaciones`; `CORREO_MODO` por defecto `apagado` | en repo; modo real **no verificable** |
| `gafete-wallet` | pase Google Wallet; 503 sin secretos | en repo; despliegue **no verificable** |
| pg_cron `notif_enviar`, `notif_recordatorios`, `notif_recordatorios_equipos` | colas y recordatorios | definidos en 0019/0041; ejecución real **no verificable** |

### 1.7 Flujos de datos

1. **Carga en dos fases** (`api.js`): `getContexto()` (perfil, criterios, períodos, rúbrica, calendario) → `getContenido(periodoId,{signal})` (por período, cancelable). Estado único en `Store.periodoId`; cada pestaña usa `necesitaCarga/marcarCargado/invalidar`.
2. **Evaluación v2**: `admin.js` (*Evaluar*) → `API.upsertEvaluacion` (`upsert` por `periodo_id,evaluado_id`) → trigger `evaluaciones_validar_modelo` (perfil, escala, completitud al publicar) → lectura por `resultados_periodo()` (SQL) → `seguimiento_global()` / `reporte_general_pe()` / Panel / Desempeño / Perfil.
3. **Evaluación clásica (legacy)**: mismo `upsert`; el total se calcula **en JS** (`calcScore`/`calcScorePuntajes`) en `user.js`, `secretario.js`, `admin.js`, `core/perfil.js`, `core/desempeno.js`, `core/inicio.js`, `admin-panel.js`, `admin-personas.js`.
4. **Distritos**: `evaluaciones_distrito` (4 competencias 0–7) → `Distritos.consolidar()` en JS.
5. **Tareas**: UI → `tareas` (triggers fijan estado) → `tarea_eventos`; aprobación con puntos → `calif_puntaje()` → `resultados_periodo()`.
6. **Notificaciones**: triggers/RPC `notif_emitir()` → `notificaciones` → campana (RPC) y correo (pg_cron → Edge `enviar-notificaciones` → Apps Script).

### 1.8 Navegación actual (de `initNav`)

| Perfil | Entradas |
|---|---|
| Miembro (`user.js`) | Inicio · Mi perfil · Mi desempeño · Calendario · Entregas |
| Secretaría (`secretario.js`) | *Mi espacio*: Inicio · Mi perfil · Mi desempeño · Calendario · Entregas — *Mi distrito*: Distrito · Tareas · Seguimiento · Reportes |
| Administración (`admin.js`) | Panel · Desempeño · Evaluar · Tareas · Personas · Equipos · Distritos · Seguimiento · Calendario · Reportes — tras el engranaje: Períodos · Actividades · Rúbrica · Roles y perfiles · Gestiones |

## 2. Arquitectura PROPUESTA (PDF §4; **propuesta, no implementada**)

Principio: reorganizar etiquetas y agrupación **sin borrar capacidades**; cada módulo responde una pregunta (PDF §4.4). Las pestañas existentes (`tab-*`) se conservan como contenedores; cambia el menú, no los módulos.

### 2.1 Responsabilidad por módulo y fuente única

| Módulo | Pregunta | Fuente de datos (ya existe) | Módulos actuales que absorbe |
|---|---|---|---|
| **Panel** | ¿Qué requiere atención ahora? | «Requiere atención» (`admin-personas.js`), KPIs mínimos | `overview` (hoy mezcla gráficos de `admin-panel.js` y atención) |
| **Desempeño** | ¿Cómo funciona una persona/equipo? | `seguimiento_global()` → `resultados_periodo()` | `core/desempeno.js`, Mi perfil → Evolución/Criterios, comparaciones del Panel (calibración, radar, mapa de calor) |
| **Seguimiento** | ¿Qué falta y quién? | `seguimiento_global()` (estado actual) | `core/seguimiento.js`, «Requiere atención» detallado, tareas vencidas |
| **Reportes** | ¿Qué ocurrió? | `reporte_general_pe()`, `reporte_actividades()` | `admin-reportes.js`, `core/reporte-general.js`, `core/reporte-equipo.js`, `core/distritos-admin.js` (ranking) |
| **Perfil** | ¿Quién es y cuál es su historial? | `Perfil` + `resultados_periodo` por persona | `core/perfil.js`, `perfil-pe.js`, `cuenta.js`, gafete |

### 2.2 Menús por perfil (PDF §4.1–4.3 → pestañas reales)

**Miembro** — Inicio (`inicio`) · Desempeño (`desempeno`; absorbe Resumen/Criterios/Evolución de `perfil`) · Mis tareas (`trabajos`, renombrar «Entregas») · Mi calendario (`calendario`) · Mi perfil (`perfil` reducido a datos, roles, distrito, gafete, preferencias; `cuenta`).
*Cambio de estructura*: hoy «Mi perfil» ya contiene el desempeño (Resumen/Criterios/Evolución) y «Mi desempeño» repite la evolución (ambos leen `seguimiento_global`). Decidir cuál de los dos conserva la evolución.

**Secretaría** — Inicio (+ Bandeja de trabajo, nueva) · Desempeño (**nuevo para el distrito**; hoy solo hay «Mi desempeño» propio y el perfil en panel lateral) · Mi distrito (`distrito`: Resumen, Personas, Estadísticas) · Tareas y revisiones (`tareas`) · Seguimiento · Reportes · Calendario.

**Administración** — *Centro de control*: Panel · Desempeño · Seguimiento — *Operaciones*: Evaluar · Tareas · Calendario — *Organización*: Personas · Equipos · Distritos — *Reportes* — *Configuración*: Gestiones · Períodos · Rúbrica · Roles y perfiles · Actividades — *Auditoría* (nueva, ver 05).

### 2.3 Qué NO cambia en la propuesta
Las 3 páginas HTML por perfil (no se unifican en un portal), las rutas `#ir/<tab>` de notificaciones (`Notif.DESTINOS` debe actualizarse a la vez que el menú; un test de `front-rediseno` y `correo.mjs` vigilan la correspondencia), `_ALIAS_TAB` de `user.js` y `secretario.js` (para que sigan abriendo enlaces guardados), y los permisos (RLS).

### 2.4 Dependencias de un cambio de navegación
`initNav` en cada portal · `Notif.DESTINOS` + `notif_tipos.destino` (columna por rol en base) · `Buscador.registrar` · `ayuda/*.html` (generados por `tools/generar-manuales.mjs`) · `_ALIAS_TAB` · `front-rediseno.mjs` (comprueba markup y acciones). Una reorganización de menú es **solo de front, sin migración**, siempre que no cambie el `tab` interno que usa `notif_tipos`.
