# Decisión de producto: diseño vivo (autorizada)

Fecha: 2026-10-28. Sustituye a las instrucciones anteriores que exigían
aprobación para generar, actualizar o exportar borradores. No elimina
historial: las aprobaciones registradas siguen visibles como revisiones
opcionales, y las baselines aprobadas conservan sus invariantes.

## Lo que cambia

- Guardar, generar y seguir diseñando no requieren aprobación.
- Ctrl+S guarda una versión y actualiza las vistas derivadas.
- La revisión (aprobar) es opcional e informativa.
- El desarrollador conserva el control de sus ediciones.
- La IA nunca sobrescribe silenciosamente contenido manual: sus
  resultados van a propuestas separadas que la persona incorpora.
- «Desactualizado» significa «requiere sincronización/revisión», no
  prohibición de trabajar. No se actualizan dependencias en silencio
  para aparentar coherencia.

## Lo que NO cambia (bloqueos estructurales vigentes)

- Referencias inexistentes, contenido inválido, conflictos de
  concurrencia (`expected_*`) y errores de disco siguen bloqueando.
- La acción de revisar (aprobar) sigue exigiendo versión actual y
  vigente, autoría humana y confirmación explícita: son las reglas de
  la propia revisión, no una barrera para otros trabajos.
- Las baselines aprobadas históricas son inmutables y reproducibles;
  sus invariantes (versiones aprobadas, actuales, coherentes, cierre de
  fuentes, nada archivado) no se relajan retroactivamente.
- El borrado seguro sigue exigiendo cero aprobaciones, cero
  dependientes, cero baselines y cero menciones en generaciones.
- Procedencia, versiones exactas como fuentes y atomicidad
  validar → persistir → publicar se conservan íntegras.

## Reglas anteriores sustituidas (contexto histórico)

1. «Solo se puede aprobar la versión actual y vigente» — VIGENTE solo
   como regla de la acción de revisar; SUSTITUIDA como requisito para
   generar, guardar, actualizar o entregar borradores.
2. «Generar diseños exige fuentes aprobadas» (`not_approved`) —
   SUSTITUIDA: se genera desde versiones actuales guardadas.
3. «Aceptar actualizaciones exige fuentes aprobadas» (`update_stale`
   por falta de aprobación, `source_not_approved`) — SUSTITUIDA: basta
   con fuentes existentes y vigentes; la revisión se informa.
4. «No basta con volver a aprobar un derivado desactualizado» —
   SUSTITUIDA como flujo obligatorio; la revisión sigue disponible
   pero ya no bloquea la sincronización.
5. «Una baseline debe incluir versiones aprobadas» — VIGENTE para
   baselines aprobadas; la entrega de trabajo/borrador es un concepto
   NUEVO y separado, sin ese requisito, y no debe llamarse coherente
   ni verificada si tiene pendientes.
6. «Estados pendiente de aprobación» — la etiqueta pasa a revisión
   opcional; el estado calculado sigue existiendo como información.

## Etapas

- Etapa A (guardar sin barreras): quitar las barreras 2–4, Ctrl+S
  central, derivados locales, automatización IA opcional por módulo
  (desactivada por defecto), entrega de trabajo/borrador exportable.
- Etapa B (mockups): artefacto Mockup versionado con editor propio,
  generación de flujo/ER desde requisitos y mockups con los contratos
  existentes, sin editor de estilos ni Figma.
