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

**Hito actual (diseño vivo, etapa B):** mockups versionados como
artefactos de primera clase, dibujados por una persona: editor visual,
Ctrl+S, y generación de flujo/ER con Meta usando requisitos y mockups
como contexto. Sin IA silenciosa, sin relajar baselines. Ver
[decisión de diseño vivo](decision-diseno-vivo.md) y
[arquitectura](arquitectura.md).

## Recorrido objetivo

Dibujar «Nueva reserva» (cliente, producto, cantidad, botón Confirmar) →
Ctrl+S → proponer flujo y ER desde requisitos y mockups → editar un
campo → Ctrl+S → ver impacto y propuesta de actualización → incorporar
sin aprobación obligatoria → cerrar/reabrir → exportar entrega de
trabajo.

## Alcance de este hito (diseño vivo, etapa B)

Mockups versionados al mismo nivel que requisitos y diseños, con las
reglas en `ruth-core`/`ruth-api`, el contrato en `ruth-meta` y las
llamadas a Meta solo desde Rust:

- Modelo: pantallas con identidad estable; componentes texto, campo,
  selector, botón y tabla; disposición separada de la semántica;
  origen declarado por campo (persistido, calculado, temporal,
  externo o sin definir): nada visual crea columnas por suposición.
  Citas a requisitos/diseños informativas; dependencias de generación
  exactas, sin ciclos, adoptadas explícitamente.
- Editor: vista Mockups con paleta, lienzo e inspector; crear,
  mover, redimensionar, editar y eliminar (con confirmación si afecta
  conexiones); zoom, desplazamiento, deshacer/rehacer y Ctrl+S. Solo
  componentes declarativos: sin HTML/JS de terceros, sin editor de
  estilos, sin importación de Figma.
- Diseño desde mockups: fuentes mixtas (requisitos + mockups) con
  resumen legible sin posiciones; generar solo desde mockups señala
  información faltante en vez de inventar certezas. Reutiliza el
  circuito de propuestas de diseño: diff, atomicidad y caducidad.
- Persistencia sin migración nueva (esquema v9: `kind` ya es texto
  libre y las tablas son genéricas) y exportación que incluye los
  mockups del alcance como JSON más resumen, sin diagramas
  inventados; las baselines históricas salen byte-idénticas.

Se conservan funcionando la etapa A (guardar sin barreras, entregas de
trabajo), el renombrado, el archivo y borrado, la edición visual del
hito 10, la exportación del hito 9, las propuestas de actualización del
hito 8, el mapa de impacto del hito 7, el diseño vinculado del hito 6,
la generación de requisitos del hito 5, la persistencia del hito 4, el
espacio de requisitos del hito 3, el núcleo del hito 2 y la prueba de
conexión.

## Hito anterior (diseño vivo, etapa A, completado)

Guardar, generar y continuar diseñando sin barreras de aprobación, con
las reglas en `ruth-core`/`ruth-api` y las llamadas a Meta solo desde
Rust:

- Generar y actualizar parten de versiones actuales guardadas; la
  revisión es opcional e informativa. Siguen vigentes identidades,
  versiones exactas, procedencia, conflictos y validación estructural.
  «Desactualizado» = requiere sincronización, no prohibición.
- Ctrl+S central (y botón Guardar) al editor activo; sin cambios no se
  crean versiones; un fallo conserva el borrador. Vistas derivadas
  (lienzo/Mermaid/impacto) locales sin API.
- Auto-actualización IA opcional por módulo, desactivada al inicio:
  debounce 2,5 s, una ejecución por módulo, máximo 5 propuestas por
  ciclo, resultados a propuestas separadas, sin recursión; si Meta
  falla, el guardado sigue válido.
- Entregas de trabajo/borrador (`entrega-N`) exportables a ZIP,
  honestas: identifican pendientes, revisiones opcionales y fuentes
  obsoletas; nunca «coherente» ni «verificada». Las baselines
  históricas conservan su significado y salen byte-idénticas.
  Esquema v9.

Se conservan funcionando el renombrado, el archivo y borrado, la
edición visual del hito 10, la exportación del hito 9, las propuestas
de actualización del hito 8, el mapa de impacto del hito 7, el diseño
vinculado del hito 6, la generación de requisitos del hito 5, la
persistencia del hito 4, el espacio de requisitos del hito 3, el núcleo
del hito 2 y la prueba de conexión.

## Hito anterior (archivo y borrado, completado)

Archivo reversible y borrado seguro de módulos y requisitos, con las
reglas en `ruth-core` y sin llamadas a Meta:

- Menú "…" en módulos y requisitos: archivar, restaurar y eliminar
  definitivamente (esto último solo cuando nada lo mencione). Resumen
  consultivo previo con contenido, dependientes (dentro/fuera del
  módulo), baselines y generaciones; la ejecución revalida en Rust.
- Archivo: oculta de las listas activas (interruptor «Mostrar
  archivados»), conserva versiones, aprobaciones, dependencias, baselines
  y generaciones, y bloquea ediciones, generaciones y aprobaciones hasta
  restaurar. Archivar un módulo oculta por contexto sin tocar archivos
  individuales; el historial sigue consultable.
- Dependencias: archivar no satisface dependencias; aprobar o entregar
  con fuentes archivadas se bloquea hasta restaurar la fuente o revisar
  la versión. Las baselines históricas siguen exportables.
- Borrado: solo módulos vacíos sin generaciones ni alcance de baselines,
  y requisitos borrador sin aprobaciones, dependientes, baselines ni
  menciones en generaciones. Sin cascadas ni reescritura de historial;
  confirmación explícita con nombre y consecuencias. Esquema v7.

Se conservan funcionando la edición visual del hito 10, la exportación
del hito 9, las propuestas de actualización del hito 8, el mapa de
impacto del hito 7, el diseño vinculado del hito 6, la generación de
requisitos del hito 5, la persistencia del hito 4, el espacio de
requisitos del hito 3, el núcleo del hito 2 y la prueba de conexión.

## Hito anterior (hito 10, completado)

Edición visual interactiva de Flujos y Datos sobre el subconjunto del
hito 6, sin llamadas a Meta y sin ampliar el contrato:

- Lienzo interactivo (React Flow diferido) para ambos tipos: zoom con
  rueda centrado en el cursor, desplazamiento por arrastre, botones
  acercar/alejar/ajustar/centrar-100 % con porcentaje, selección y
  movimiento, creación de conexiones arrastrando o por teclado, y modo
  lectura para versiones históricas.
- Editor de Datos: entidades (crear, renombrar, eliminar), atributos
  (nombre y marca PK, lo que el contrato representa) y relaciones con
  cardinalidades, con inspector y confirmación de borrados con
  consecuencias. Edita el modelo, no filas reales: sin SQL.
- Editor de Flujos: pasos, decisiones, inicio y fin, etiquetas y ramas,
  citas a requisitos conservadas y avisos estructurales sin prohibir
  ciclos válidos.
- Borrador elevado con deshacer/rehacer semántico, validación
  orientativa en frontend y autoritativa en Rust, y guardado como versión
  nueva con procedencia humana, fuentes declaradas vigentes y
  disposición en la misma transacción (esquema v6); reordenar sin
  cambiar semántica solo guarda disposición. Protección al navegar,
  bloqueo de aprobación con ediciones pendientes y recálculo de Impacto.

Se conservan funcionando la exportación del hito 9, las propuestas de
actualización del hito 8, el mapa de impacto del hito 7, el diseño
vinculado del hito 6, la generación de requisitos del hito 5, la
persistencia del hito 4, el espacio de requisitos del hito 3, el núcleo
del hito 2 y la prueba de conexión.

## Hito anterior (hito 9, completado)

Baseline aprobada y exportación reproducible, reutilizando el mecanismo de
baselines de `ruth-core` y sin llamadas a Meta:

- Botón Exportar con diálogo de entregas: preparación con versiones
  exactas, cierre de dependencias, aprobaciones, bloqueos concretos y
  fuera de alcance; la preparación no muta y la creación revalida
  (`changed_since_preview` ante cambios intermedios).
- Creación humana explícita con nombre y descripción: baseline inmutable
  y persistida (esquema v5), consultable y exportable aunque el proyecto
  avance; el listado señala el avance posterior.
- ZIP reproducible con código local: README, especificación, manifiesto
  versionado con SHA-256, contenidos originales, diagramas Mermaid y
  contexto de implementación honesto; sin claves, SQLite, chats ni
  descartes. Solo desde la baseline, con orden, rutas y metadatos
  normalizados.
- Guardado seguro con diálogo nativo: cancelar no escribe, reemplazo con
  confirmación, temporal y renombre atómico; baseline creada y archivo
  exportado como pasos separados. En navegador se informa que exportar
  requiere escritorio.

## Hito anterior (hito 8, completado)

Propuestas de actualización con Meta sobre diseños pendientes, reutilizando
el sistema de generaciones (mismo esquema, validación, registro y
aceptación) y sin llamadas reales en pruebas:

- Acción "Proponer actualización" desde el inspector: snapshot con
  objetivo, diseño actual, fuentes con sus dos versiones, cambio origen,
  caminos y bloqueos (fuentes sin aprobar, intermedios desactualizados).
- Generación explícita para un diseño por vez, con los mismos límites,
  timeout y marca de una generación por módulo que la creación.
- Comparación: diagramas alternables, diff estructural determinista,
  fuentes anteriores y nuevas, explicación y preguntas; editor JSON con
  revalidación, re-render y re-diff.
- Aceptación atómica e idempotente sobre el mismo artefacto y versión del
  snapshot, con fuentes aprobadas y vigentes; descarte que bloquea.
- Propuestas desactualizadas conservadas con nueva generación explícita;
  sin versión creada con propuesta pendiente ante fallos.
- Impacto con "pendiente de aprobación" diferenciado y recalculo que
  conserva pendientes; persistencia v4 con migración que conserva todo.

Se conservan funcionando el mapa de impacto del hito 7, el diseño vinculado
del hito 6, la generación de requisitos del hito 5, la persistencia del
hito 4, el espacio de requisitos del hito 3, el núcleo del hito 2 y la
prueba de conexión.

## Hito anterior (hito 7, completado)

Mapa de impacto del cambio, con `ruth-core` como única autoridad del
dominio y sin llamadas a Meta:

- Consulta `core_impact_report`: origen con comparación de versiones,
  dependientes directos e indirectos, fuentes utilizadas frente a actuales,
  caminos explicativos y estado calculado. Sin mutaciones.
- Pestaña Impacto: encabezado, Antes/Ahora, mapa, tabla paginada,
  inspector y contador derivado de pendientes únicos.
- Grafo SVG propio de lectura con selección, zoom y ajuste; truncado
  explícito; texto e iconos además del color; sin dependencias nuevas.
- Estados honestos (aprobación histórica + desactualización conviven) y
  resolución solo mediante nueva versión revisada.
- Inspector con Ver diferencias, Abrir diseño/requisito y Ver fuentes;
  recalculo tras mutaciones; contexto conservado al volver.

Se conservan funcionando el diseño vinculado del hito 6, la generación de
requisitos del hito 5, la persistencia del hito 4, el espacio de requisitos
del hito 3, el núcleo del hito 2 y la prueba de conexión.

## Hito anterior (hito 6, completado)

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

Archivo o borrado individual de diseños y mockups (solo se archivan por
contexto del módulo), tipos de atributo, obligatoriedad y FK por
atributo (fuera del subconjunto de diseño; el editor ofrece nombre y
marca PK), editor de estilos de mockups, importación de Figma, minimapa
del lienzo, edición colaborativa, ejecución automática de cambios,
análisis de impacto con IA, terminales, generación de código, editor de
código, importación de repositorios, agentes múltiples, sincronización
remota, publicación y despliegue.

## Nota de transparencia sobre trabajo previo

Antes del evento existió una exploración previa bajo los nombres
Atelier / Ruth IDE. Se declara aquí con transparencia: **su código no se ha
leído, copiado ni reutilizado** en este repositorio. Todo el contenido de esta
carpeta se creó desde cero durante el hackathon para la categoría Indie.
