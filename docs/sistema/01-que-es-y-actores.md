# 01 · Qué es el sistema y quién lo usa

## 1.1 Propósito

EIGHT CREATORS LABs es el **portal de evaluación del desempeño** del equipo creativo de CELIDER 08 Santiago. Sirve para tres cosas encadenadas:

1. **Organizar el trabajo**: quién hace qué, para cuándo, con qué rol y en qué equipo (tareas individuales y de equipo, calendario, actividades).
2. **Evaluar a las personas** con una rúbrica por roles y con las notas de las tareas, de forma comparable, reproducible y con rastro de cada cambio.
3. **Leer los resultados**: cada persona ve cómo le va, cada secretaría ve su distrito, la administración ve todo el equipo y el ranking de distritos.

No es un sistema de nómina ni de asistencia. No guarda archivos de trabajo (solo **enlaces** a ellos), salvo la foto de perfil y las capturas de estadísticas de Instagram de cada distrito.

## 1.2 Cómo está construido (en una página)

- **Páginas estáticas** (HTML, CSS y JavaScript sin compilar) servidas por Vercel. No hay servidor propio: cada página habla directamente con Supabase.
- **Supabase** es la base de datos (PostgreSQL), el sistema de cuentas (Auth), el almacenamiento de archivos (Storage) y el canal de tiempo real (Realtime). Toda regla importante vive **en la base de datos** (funciones, disparadores y políticas de seguridad por fila), no en la pantalla: la pantalla solo presenta.
- **Tres portales** según quién entra: `user.html` (miembros), `secretario.html` (secretarías de distrito) y `admin.html` (administración). Una página de entrada (`index.html`) para iniciar sesión o crear cuenta, una página pública de verificación de gafetes (`/v/<código>`) y los manuales de uso (`ayuda/`).
- **Correo**: una cola de avisos que se envía con una función de Supabase (`enviar-notificaciones`) a través de un puente de Google Apps Script. Los correos de Auth (confirmar cuenta, recuperar contraseña) pasan por otra función (`auth-correo`).
- **Pase de Google Wallet**: una tercera función (`gafete-wallet`) crea el pase del gafete (todavía sin configurar: faltan la cuenta emisora y los secretos).

Detalle técnico: capítulo 12 y `docs/documentacion-tecnica.md`.

## 1.3 Los tres tipos de acceso (rol funcional)

El **rol funcional** decide **qué puede hacer una persona en el sistema**. Lo asigna **solo la administración** y la base de datos lo impone: ni el registro ni la propia persona pueden cambiarlo.

| Tipo de acceso | Cómo se identifica | Portal | Qué puede, en una frase |
|---|---|---|---|
| **Miembro** | `tipo_miembro = 'miembro'`, `es_admin = false` | `user.html` | Ve y trabaja lo suyo: sus tareas, su evaluación, su perfil, su desempeño, su gafete, el calendario, los recursos |
| **Secretaría de distrito** | `tipo_miembro = 'secretario'` con un distrito | `secretario.html` | Todo lo de un miembro **más** supervisar y trabajar con su distrito: ver a su gente, asignar y revisar tareas, crear actividades de su distrito, seguimiento, desempeño y reportes de su distrito, y subir las estadísticas de Instagram de su distrito |
| **Administración** | `es_admin = true` | `admin.html` | Todo el sistema: personas, accesos, períodos, rúbrica, evaluar, tareas, equipos, distritos, reportes, auditoría, configuración. **No se evalúa a sí misma** |

Reglas que nunca cambian:

- **Registrarse no da ningún permiso.** La cuenta nace como miembro, sin distrito, sin rol y **sin acceso aprobado**; hasta que la administración la aprueba, la persona no entra al portal (verificado: trigger `on_auth_user_created` y `profiles_bloquear_privilegios`).
- Los campos privilegiados (`es_admin`, `tipo_miembro`, `distrito`, `rol_id`, `aprobado`) los frena un disparador de la base de datos para cualquiera que no sea administración.
- **Nadie aprueba su propia tarea**, ni siquiera una secretaría; y la administración no se evalúa.
- La seguridad es **de la base de datos** (políticas por fila). El portal nunca filtra «por si acaso»: lo que una persona no puede ver, la base no se lo entrega.

## 1.4 Los roles del equipo (rol operativo)

El **rol operativo** es lo que la persona *hace* en el equipo. Es distinto del tipo de acceso. Se guarda en la tabla `roles` y cada rol tiene: nombre, descripción, responsabilidades y requisitos (que ve la persona cuando le asignan una tarea, en Mi cuenta y en la bienvenida).

Los ocho roles de partida (la asignación exacta a la tabla `roles` es un dato que decide el dueño): **Fotografía, Diseño Gráfico, Video / Edición, Redacción, Redes Sociales, Producción, Dirección y Comunicaciones**.

Una persona puede tener, desde la migración 0062:

- **Rol principal** (`profiles.rol_id`): decide su **perfil de evaluación** (qué criterios técnicos se le puntúan y con qué pesos) y es donde se puntúa el **núcleo transversal**.
- **Un rol secundario** (opcional, una fila en `persona_roles` distinta del principal): un segundo rol con el que también puede trabajar y ser evaluada. **Máximo 2 roles distintos por persona.** Las personas que ya tenían más de dos no se tocan: la base las lista y el portal les pide dejar uno.
- **Preferencias de rol** (`preferencias_rol`): lo que la persona *quiere* hacer, en orden, con un rol predeterminado. Es **información para quien asigna, nunca una restricción ni un permiso**.

Las cuatro cosas **nunca se mezclan**: tipo de acceso · rol principal · rol secundario/permitidos · preferencias.

## 1.5 Gestión, período y participación

- **Gestión** = el año de trabajo (por ejemplo «2026-2027»). Cada gestión tiene **sus propios** períodos, criterios, rúbrica, perfiles, calendario y actividades. Una gestión pasada queda **en solo lectura**: se lee siempre, no se escribe nunca (lo impone la base con `gestion_escribible()`). Al abrir una gestión nueva se archiva la anterior y se clona el catálogo de criterios y la última versión de cada perfil.
- **Período de evaluación (PE)** = una etapa dentro de la gestión (PE1, PE2, PE3…). Cada uno tiene **cuatro fechas** (inicio, fin del trabajo, entrega de resultados, jornada de cierre), un **modelo de rúbrica** (`v2` por roles o `legacy` clásica) y puede estar **activo**. **Solo uno está activo a la vez** (índice único parcial; se cambia con `set_periodo_activo`).
- **Participación**: una persona participa en un PE salvo que la administración la marque como no participante. **Un PE en el que no participas no existe para ti**: no aparece en tus selectores, perfil, evolución ni calendario.
- **Modelo del período**: los períodos anteriores a la rúbrica por roles son **clásicos** (7 criterios de 0 a 4 + bono, máximo 30). Los nuevos son **por roles** (24 criterios: 5 núcleo + 19 técnicos, resultado de 0 a 100). Los dos modelos **nunca se mezclan** ni se promedian; el modelo de un período no cambia una vez que tiene evaluaciones. Las **tareas y los equipos existen solo en períodos por roles**.

## 1.6 Vocabulario base

| Término | Significado |
|---|---|
| **Publicada** | Una evaluación que ya cuenta oficialmente. Solo las publicadas cuentan en resultados, ranking, desempeño y reportes. Un **borrador** no es un resultado |
| **Núcleo** | Las 5 competencias transversales, iguales para todos los roles: plazos, respuesta, colaboración, iniciativa, calidad |
| **Técnico** | Las competencias propias del rol, con pesos que suman 100 |
| **Percentil** | Posición de la persona dentro de su rol, de 0 a 100 |
| **Nota de tareas** | Resumen de 0 a 100 de las tareas aprobadas con puntos, que entra al resultado según el peso que fije el PE |
| **Nivel** | Excelente, Bueno, En proceso, Bajo, según cortes de puntaje (capítulo 7) |
| **Iniciativa propia** | Tarea que la persona crea para sí misma («Mi iniciativa») |
| **Equipo** | Grupo de personas para **un** período por roles, con tareas compartidas |
| **Distrito** | Agrupación territorial de personas; tiene su propia evaluación y ranking |
| **Aviso** | Notificación en la campana y, según el tipo, por correo |

## 1.7 Quién ve qué (resumen)

| Quién | Ve |
|---|---|
| Miembro | Solo lo suyo: su perfil, evaluaciones **publicadas** suyas, sus tareas, sus equipos, calendario, recursos, avisos |
| Secretaría | Lo suyo **más** las personas de su distrito (perfiles, tareas, seguimiento, desempeño, reportes) y los equipos con personas de su distrito; evaluaciones **publicadas** de su distrito; el ranking de distritos (los demás distritos se muestran sin detalle) |
| Administración | Todo, incluidos los **borradores** de evaluación |

La matriz completa por funcionalidad y por tabla está en `docs/auditoria/02-matriz-funcionalidades-permisos.md`.
