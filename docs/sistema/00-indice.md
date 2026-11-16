# Documentación completa del sistema · EIGHT CREATORS LABs

Portal de evaluación del desempeño del equipo de **CELIDER 08 Santiago** (eight-coms.vercel.app).
Estado descrito: **15 de noviembre de 2026**, con las migraciones **0001 a 0064** aplicadas por el dueño del proyecto en su base de Supabase. La **0065** (nivel de tarea, tipo de entrega y quién evalúa la iniciativa) está entregada y **pendiente de aplicar**: los capítulos 05, 07, 11 y 12 la describen.

Este es el documento completo del sistema. No es un resumen: describe **qué es cada cosa, quién la hace, en qué pantalla, con qué reglas, qué avisa, qué guarda y qué puede salir mal**, proceso por proceso, y termina con un análisis de qué está donde no debe y qué funciones importantes quedaron escondidas.

## Cómo está organizado

| Capítulo | Qué responde |
|---|---|
| [01 · Qué es el sistema y quién lo usa](01-que-es-y-actores.md) | Propósito, los tres tipos de acceso, los roles del equipo, las gestiones y los períodos, vocabulario base |
| [02 · Mapa de procesos](02-mapa-de-procesos.md) | Los 22 procesos del sistema, cómo se encadenan de punta a punta y qué pantalla es la «casa» de cada uno |
| [03 · Acceso, cuenta y bienvenida](03-proceso-acceso-cuenta.md) | Registro, confirmación, aprobación, entrar, recuperar contraseña, instalar la app, Mi cuenta, preferencias, bienvenida |
| [04 · Organización del año](04-proceso-organizacion.md) | Gestiones, períodos, participación, personas, roles y segundo rol, perfiles de evaluación, rúbrica, distritos, equipos |
| [05 · Tareas](05-proceso-tareas.md) | Tarea individual, iniciativa propia, tarea de equipo, estados, entrega, revisión, nota, correcciones, plazos, historial |
| [06 · Evaluación](06-proceso-evaluacion.md) | Evaluar por rol, borrador, publicar, rectificar, versiones, cobertura, rúbrica clásica, evaluación de distrito |
| [07 · Cálculo de resultados](07-calculos-y-resultados.md) | Fórmulas exactas, niveles, percentil, nota de tareas, dos roles, ejemplos numéricos y cada regla de borde |
| [08 · Seguimiento, desempeño, reportes y distritos](08-seguimiento-desempeno-reportes.md) | Cómo se lee lo que ya está calculado: quién está al día, cómo les va, reportes, ranking de distritos, Instagram |
| [09 · Comunicación](09-proceso-comunicacion.md) | Calendario, actividades, avisos de la campana, correos, banco de imágenes |
| [10 · Gafetes, auditoría, configuración y tiempo real](10-gafetes-auditoria-config-sync.md) | Gafete con QR y Wallet, centro de auditoría, Configuración general, sincronización sin recargar |
| [11 · Pantallas por portal](11-pantallas-por-portal.md) | Cada pantalla de los tres portales: para qué sirve, quién la ve, qué se hace en ella |
| [12 · Datos, seguridad y operación](12-datos-seguridad-operacion.md) | Tablas, funciones, permisos, migraciones, trabajos programados, correo, despliegue, pruebas |
| [13 · Análisis y propuesta de ubicación](13-analisis-y-propuesta.md) | Qué está redundante, escondido o fuera de lugar, y dónde debería estar |
| [14 · Glosario y pendientes](14-glosario-y-pendientes.md) | Términos, decisiones abiertas, lo que no se pudo verificar |

Hay además una versión de **un solo archivo** con todos los capítulos seguidos: [`../DOCUMENTACION-COMPLETA-DEL-SISTEMA.md`](../DOCUMENTACION-COMPLETA-DEL-SISTEMA.md).

## Cómo leer los avisos de honestidad

- **Verificado** = salió de leer el código o de una prueba que corre en este repositorio (`tools/pruebas`).
- **No verificado contra la base viva** = se describe lo que el código y las migraciones hacen, pero no se pudo comprobar en la base real de producción (el conector de Supabase de las sesiones de trabajo no tiene acceso de escritura ni siempre de lectura).
- **Decisión pendiente** = una regla que hoy tiene un valor provisional y necesita que el dueño la confirme.

## Documentos hermanos

Esta documentación **reúne y ordena**; el detalle técnico fino sigue en: `CLAUDE.md` (reglas de trabajo y trampas aprendidas), `docs/documentacion-tecnica.md` (arquitectura resumida), `docs/auditoria/` (hallazgos H-01…H-12 y matrices de permisos y fórmulas), `docs/sincronizacion-tiempo-real.md`, `docs/notificaciones-contrato.md`, `docs/configurar-correos.md`, `docs/google-wallet.md` y los manuales de uso en `ayuda/`.
