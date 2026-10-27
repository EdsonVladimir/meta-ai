# Alcance de competencia — Ruth IDE (categoría Indie)

## Producto objetivo

Un workspace visual que transforma requisitos en artefactos de diseño
vinculados. Cuando cambia una regla, identifica dependencias afectadas y
propone ajustes que una persona revisa y aprueba.

## Horizonte

**Visión completa:** requisitos → diseño → arquitectura → implementación →
verificación → code review.

**Objetivo de competencia:** requisitos vinculados a flujo y ER → cambio de
regla → impacto → propuestas → aprobación → exportación.

**Hito actual (hito 6):** diseño vinculado a requisitos (flujo o ER)
generado con Meta y distribución visual inspirada en el mockup: seleccionar
requisitos aprobados, generar una propuesta estructurada, visualizarla con
Mermaid local, revisarla y aceptarla como borrador con dependencias exactas.
La aprobación sigue siendo humana. Ver [arquitectura](arquitectura.md).

## Recorrido objetivo

Describir un módulo → generar requisitos con Meta → generar flujo y ER →
aprobar → cambiar una regla → analizar impacto → revisar propuestas →
exportar versiones aprobadas.

## Alcance de este hito (hito 6)

Diseño vinculado a requisitos y distribución visual, con `ruth-core` como
única autoridad del dominio:

- Composición inspirada en el mockup: tema oscuro, encabezado compacto,
  izquierda con módulos y artefactos (requisitos + diseños), centro con
  vistas Requisitos/Diseño, derecha con generación, fuentes y revisión; sin
  botones que simulen el mapa de impacto del siguiente hito.
- Generación por módulo y tipo (flujo o ER) desde requisitos aprobados
  seleccionados; cada tipo con acción independiente, sin regenerar al
  navegar.
- Subconjunto estructurado inicial (JSON acotado) validado en Rust, con
  referencias dentro del conjunto enviado; un ciclo de flujo es válido y no
  se confunde con los ciclos prohibidos del grafo de dependencias.
- Renderizado local a Mermaid mediante serializador determinista con
  etiquetas escapadas, carga bajo demanda y `securityLevel: strict`; el
  JSON es autoritativo y Mermaid se deriva, nunca se edita.
- Revisión con editor JSON validado y "Aceptar como borrador" idempotente
  (crea el artefacto o una nueva versión con la versión esperada); aprobar
  exige confirmación humana, contenido validado y renderizado, y revalidar
  vigencia y versión actual en Rust.
- Dependencias exactas a las versiones utilizadas; fuentes obsoletas
  bloquean la aceptación y el núcleo calcula la revisión pendiente.
- Persistencia v3 con migración que conserva las v1/v2: generaciones,
  propuestas y procedencia de diseño; atomicidad dominio → base → UI.
- Pruebas con fixtures y generador falso, sin red ni clave real.

Se conservan funcionando la generación de requisitos del hito 5, la
persistencia del hito 4, el espacio de requisitos del hito 3, el núcleo
del hito 2 y la prueba de conexión.

## Hito anterior (hito 5, completado)

Generación asistida de requisitos con Meta, con `ruth-core` como única
autoridad del dominio:

- Panel por módulo: descripción, vista previa del contexto, botón de
  generación, propuestas editables, preguntas separadas y aceptación o
  descarte individual. Sin sustituciones ni guardados automáticos.
- Privacidad: solo viajan descripción y requisitos del módulo activo; aviso
  explícito; clave y petición solo desde Rust; sin llamadas al arrancar,
  escribir o navegar.
- Salida estructurada (`text.format` con esquema JSON, plantilla v1) y
  validación autoritativa en Rust (máximo 8 propuestas y 5 preguntas).
- Una generación simultánea por módulo, sin reintentos, sin bloqueos
  durante la red, con modelo y tokens visibles y errores distinguibles.
- Persistencia v2 con migración que conserva las v1: generaciones,
  propuestas y su estado; caducidad calculada que bloquea aceptar.
- Aceptación atómica e idempotente como borrador IA, sin dependencias
  inventadas; la aprobación humana sigue intacta.
- Pruebas con generador falso y fixtures, sin red ni clave real.

Se conservan funcionando la persistencia del hito 4, el espacio de
requisitos del hito 3, el núcleo del hito 2 y la prueba de conexión.

## Hito anterior (hito 4, completado)

Persistencia local fiable con SQLite: esquema versionado, mutaciones
atómicas validadas antes de guardar, arranque validante con error
recuperable, escrituras serializadas y segunda instancia detectada.

## Hito anterior (hito 3, completado)

Definir y revisar requisitos desde la interfaz, con `ruth-core` como única
autoridad del dominio: frontera Tauri (`ruth-api` + comandos `core_*`),
espacio de requisitos con editor y revisión, Zustand solo para selección y
paneles, y sesión temporal en memoria (ahora sustituida por persistencia).

## Hito anterior (hito 2, completado)

Núcleo de artefactos, versiones, dependencias y aprobaciones en Rust,
independiente de Tauri, React, Meta y almacenamiento. Ver
[arquitectura](arquitectura.md).

## Hito anterior (hito 1, completado)

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

Mapa interactivo de impacto, propuestas automáticas de actualización,
análisis de impacto con IA, terminales, generación de código, editor de
código, importación de repositorios, agentes múltiples, sincronización
remota, publicación y despliegue.

## Nota de transparencia sobre trabajo previo

Antes del evento existió una exploración previa bajo los nombres
Atelier / Ruth IDE. Se declara aquí con transparencia: **su código no se ha
leído, copiado ni reutilizado** en este repositorio. Todo el contenido de esta
carpeta se creó desde cero durante el hackathon para la categoría Indie.
