# Alcance de competencia — Ruth IDE (categoría Indie)

## Producto objetivo

Un workspace visual que transforma requisitos en artefactos de diseño
vinculados. Cuando cambia una regla, identifica dependencias afectadas y
propone ajustes que una persona revisa y aprueba.

## Recorrido objetivo

Describir un módulo → generar requisitos con Meta → generar flujo y ER →
aprobar → cambiar una regla → analizar impacto → revisar propuestas →
exportar versiones aprobadas.

## Alcance de este hito (hito 1)

Base de escritorio y prueba mínima de conexión real con Meta:

- Estructura mínima Tauri 2 + Rust + React + TypeScript + Vite, creada desde
  cero.
- Interfaz inicial con marca, descripción, estado de conexión y botón
  **Probar conexión**.
- Llamada mínima a Meta Model API desde Rust con manejo de errores
  distinguido y sin exponer la clave.
- Aviso en navegador de que la prueba nativa requiere Tauri.
- Documentación, `.gitignore` y repositorio Git inicializado, sin publicar.

## Fuera de alcance de este hito

Explorador, terminales, editor de código, SQLite, diagramas, generación de
requisitos, agentes múltiples y despliegue.

## Nota de transparencia sobre trabajo previo

Antes del evento existió una exploración previa bajo los nombres
Atelier / Ruth IDE. Se declara aquí con transparencia: **su código no se ha
leído, copiado ni reutilizado** en este repositorio. Todo el contenido de esta
carpeta se creó desde cero durante el hackathon para la categoría Indie.
