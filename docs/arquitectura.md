# Arquitectura — Ruth IDE

## 1. Horizonte

**Visión completa.** Espacio de trabajo visual que recorre el ciclo entero:
requisitos → diseño → arquitectura → implementación → verificación → code
review, con artefactos vinculados, impacto ante cambios y aprobación humana.

**Objetivo de competencia.** Un recorrido reducido pero completo: requisitos
vinculados a flujo y ER → cambio de regla → impacto → propuestas → aprobación
→ exportación de versiones aprobadas.

**Hito actual (hito 9).** Baseline aprobada y exportación reproducible:
preparación consultiva con cierre de dependencias, creación humana
explícita y persistida, y ZIP determinista con manifiesto y SHA-256
generado con código local, sin llamadas a Meta. Ver
[alcance](alcance-hackathon.md).

## 2. Arquitectura

Monolito modular con núcleo independiente y adaptadores en las fronteras:

- **Núcleo (`ruth-core`, Rust).** Autoridad de versiones, dependencias,
  aprobaciones y baselines. Independiente de Tauri, React, Meta y
  almacenamiento. No lee reloj, entorno, archivos ni red.
- **Adaptador Meta (`ruth-meta`, Rust).** Contrato pequeño detrás del cual
  viven las llamadas reales a Meta Model API: prueba de conexión y
  generación estructurada con validación autoritativa en Rust.
- **Comandos Tauri (`src-tauri`).** Frontera entre el escritorio y Rust.
- **Frontera (`ruth-api` + comandos `core_*`).** DTOs serializables,
  errores estables, identificadores y fechas generados fuera del dominio.
  Mutaciones atómicas vía `transact` (validar → persistir → publicar),
  siempre por casos de uso, sin duplicar reglas. El núcleo sigue sin Tauri
  ni Serde.
- **Persistencia (`ruth-store`, Rust).** Adaptador SQLite separado del
  dominio: esquema versionado, actor con hilo dedicado y validación antes
  de cada escritura. El núcleo no conoce SQLite; el adaptador no valida
  reglas, solo lee y escribe verbatim.
- **React (`src`).** Espacio de trabajo (navegador, centro
  Requisitos/Diseño, revisión): presenta instantáneas autoritativas de Rust
  y mantiene borradores locales.
- **Zustand.** Solo selección compartida (proyecto, módulo, requisito o
  diseño), vista central y visibilidad de paneles, con selectores
  específicos.

Reglas de dependencia: el núcleo no conoce a Tauri, React, Meta ni SQLite.
Los adaptadores llaman al núcleo, nunca al revés.

## 3. Núcleo: modelo

Entidades (`crates/core/src/domain/model.rs`):

- **Proyecto y módulo**, identificados explícitamente. El módulo organiza;
  no aísla: las dependencias pueden cruzar módulos del mismo proyecto.
- **Artefacto**: identidad estable y tipo (`Requirement`, `Flow`,
  `DataModel`).
- **Versión inmutable**: identidad, número consecutivo, contenido textual no
  vacío, procedencia y fuentes exactas.
- **Procedencia**: autor humano o propuesta de IA.
- **Dependencia**: versión derivada → versión exacta de una fuente. Solo
  dependencias de generación, sin ciclos. No hay relaciones semánticas en
  este hito.
- **Aprobación**: versión exacta, autor humano y fecha suministrada.
- **Informe de impacto**: artefactos afectados y caminos que lo justifican.
- **Baseline**: conjunto coherente de versiones aprobadas para exportación
  futura; inmutable y reproducible.

Casos de uso (`crates/core/src/application/store.rs`, en memoria): crear
proyecto, módulo y artefacto; crear versión; aceptar borrador de IA;
registrar fuentes al crear la versión derivada; calcular vigencia e impacto;
aprobar; crear baseline.

**Procedencia humana no es autenticación.** Que una versión o aprobación
registre un autor humano es un dato del dominio; el control de identidad se
implementará en la frontera correspondiente (Tauri/UI), no en el núcleo.

## 4. Núcleo: invariantes

- Una edición crea una versión nueva; el historial nunca cambia.
- Una versión nueva no hereda aprobaciones; las históricas nunca se borran.
- Solo se aprueba la versión actual y vigente, con acción humana explícita.
- Una propuesta de IA no puede aprobarse a sí misma: solo aprueban personas.
- Aceptar contenido de IA lo incorpora como borrador; no equivale a aprobarlo.
- Dependencias con versiones exactas, nunca "latest".
- Se rechazan referencias inexistentes, cruces entre proyectos y ciclos.
- Una generación con fuentes antiguas se conserva pero calcula como no
  vigente; para aprobar hay que crear una versión revisada con fuentes
  actuales. No basta con volver a aprobar el derivado desactualizado.
- La vigencia se calcula desde las dependencias; no hay flags almacenados.
- Recalcular vigencia o impacto no modifica versiones ni aprobaciones.
- El impacto es transitivo e incluye los caminos de dependencia.
- Las operaciones sensibles reciben la versión esperada y rechazan cambios
  si ya no es la actual (concurrencia optimista).
- Una baseline exige entradas aprobadas, actuales y cerradas bajo fuentes;
  una vez creada, permanece inmutable aunque cambie el proyecto.
- Ante un error no hay mutaciones parciales: todo se valida antes de mutar.

## 5. Decisiones

- **Cero dependencias en `ruth-core`**: ni async, ni serde, ni relojes. Los
  identificadores y fechas llegan como entradas.
- **Tipos explícitos y errores de dominio** frente a strings ambiguos.
- **Sin traits, contenedores de inyección ni módulos vacíos**: el diseño no
  los necesita en este hito.
- **Registrar fuentes = crear la versión que las declara.** Como las
  versiones son inmutables, las fuentes exactas se fijan al crear cada
  versión; no existe "adjuntar fuentes después".
- **Borrador = versión sin aprobación.** No hay estado extra: se deriva de
  las aprobaciones registradas.
- **El ejemplo de Ventas** (`crates/core/tests/sales.rs`) es la prueba
  verificable del hito, sin llamar a Meta.

## 6. Persistencia (hito 4)

Contrato mínimo (`crates/store/src/lib.rs`): la unidad guardada es el
snapshot completo (`Snapshot` + `next_id`); cada mutación reescribe la base
en una transacción (costo O(tamaño), suficiente para el volumen del
hackathon). Identidades, versiones, fuentes, aprobaciones y baselines se
conservan verbatim: jamás se regeneran identificadores ni fechas al cargar.

- **Ubicación.** `ruth.db` en el directorio de datos resuelto por Tauri
  (`app_data_dir`): Linux `~/.local/share/ide.ruth.app/`, macOS
  `~/Library/Application Support/ide.ruth.app/`, Windows
  `%APPDATA%\ide.ruth.app\`. Nunca el repo ni rutas fijas; los `*.db` de
  desarrollo están excluidos en `.gitignore`.
- **Esquema.** v4 en `schema.rs`, con `user_version` y migraciones
  transaccionales e idempotentes (v1→v2→v3 añaden tablas; v4 añade
  columnas de objetivo a generaciones de diseño). Conserva tipos de
  artefacto y baselines aunque no tengan pantalla. No guarda claves,
  borradores ni selección.
- **Atomicidad.** `transact` clona en memoria, valida con el núcleo,
  persiste en transacción y solo entonces publica; `IdGen` usa
  checkpoint/restore para no avanzar ante fallos.
- **Arranque.** Cargar y revalidar con `Store::reconstitute` (todas las
  invariantes del §4, más Baselines cerradas y aprobaciones íntegras);
  estado vacío solo en instalación nueva. Ante corrupción, esquema futuro
  o error de lectura, `core_status` expone un error recuperable y la app
  abre en modo degradado sin borrar ni reparar nada.
- **Concurrencia.** Un `Mutex` en proceso, un hilo dedicado con una sola
  conexión, transacciones `IMMEDIATE` y bloqueo `EXCLUSIVE` persistente:
  una segunda instancia recibe un error claro en vez de corromper la base.
  Los bloqueos nunca se mantienen durante red (los comandos del núcleo no
  hacen red y los de Meta no tocan este estado).
- **Interfaz.** Banner "Persistencia local activa" con estado
  borrador/guardando/guardado/error; el borrador se conserva ante fallos y
  las advertencias por cambios sin guardar se mantienen. Un borrador sin
  guardar no sobrevive al cierre.

## 7. Generación asistida (hito 5)

Flujo por módulo: describir → vista previa del contexto → generar →
propuestas editables + preguntas → aceptar o descartar individualmente.

- **Privacidad.** Solo viajan la descripción y las versiones actuales de
  los requisitos del módulo activo (con topes deterministas); la interfaz
  muestra qué se enviará y avisa de que va a Meta. Clave y petición solo
  en Rust; sin llamadas al arrancar, escribir o navegar.
- **Salida estructurada.** Responses API con `text.format`
  (`type: "json_schema"`, verificado en
  `https://dev.meta.ai/docs/structured-output`) y plantilla v1 que pide
  señalar ambigüedades y no inventar decisiones como aprobadas. La
  validación autoritativa es `ruth-meta`: campos, tipos, no vacío,
  temporales únicos, máximo 8 propuestas y 5 preguntas. Lo demás se
  rechaza sin crear artefactos.
- **Ejecución.** Una generación simultánea por módulo (marca en memoria),
  timeout de 90 s, `max_output_tokens` 4096, tope de cuerpo 256 KiB, sin
  reintentos. El comando fotografía el contexto, suelta todos los bloqueos
  durante la red y registra después. Modelo y tokens visibles cuando la API
  los da; sin precios inventados. Errores distinguibles: clave,
  facturación, rate limit, timeout, incompleta e inválida.
- **Registro.** Cada generación persiste identidad (`gen-N`), proyecto y
  módulo, modelo, descripción, versiones exactas de contexto, plantilla,
  uso, preguntas y propuestas con estado. Sin claves, cabeceras ni crudos.
- **Caducidad.** Se calcula al servir: cambió alguna fuente → generación
  desactualizada, vinculada a su contexto original, con aceptación
  bloqueada hasta generar de nuevo. Nada actual se descarta ni sobrescribe.
- **Aceptación.** Ids definitivos de la app; `accept_ai_draft` del núcleo
  con agente `ruth-gen/{modelo}`, sin fuentes (el contexto no es
  dependencia) y sin aprobación; contenido canónico compuesto desde los
  campos editados y revalidados. Atómica (dominio + estado en una
  transacción) e idempotente (reintentar devuelve lo existente).
- **Interfaz.** Funcionalidad `proposals` separada (panel, coordinación,
  adaptador): borradores locales, instantáneas de Rust, montaje por módulo
  (las respuestas tardías no tocan otro módulo) y consulta de guardadas al
  volver. Zustand sigue solo para selección compartida.

## 8. Diseño vinculado a requisitos (hito 6)

Flujo por módulo y tipo: seleccionar requisitos aprobados → generar flujo
o ER → visualizar, revisar y editar el JSON → aceptar como borrador con
dependencias exactas → aprobar humanamente.

- **Distribución.** Composición inspirada en el mockup (tema oscuro,
  encabezado compacto, menta/ámbar): raíl de paneles, izquierda con
  módulos y artefactos (requisitos + diseños), centro con vistas
  Requisitos/Diseño, derecha con generación, fuentes y revisión, y barra
  de estado con el guardado. Sin React Flow y sin simular el mapa de
  impacto.
- **Subconjunto inicial.** JSON acotado: flujo con nodos
  (`start|step|decision|end`, identidad/tipo/etiqueta) y aristas
  (origen/destino/etiqueta opcional); ER con entidades (nombre/atributos
  con clave opcional) y relaciones (extremos y cardinalidades
  `1|0..1|N|0..N`). Referencias a requisitos por elemento, siempre dentro
  del conjunto enviado. Un ciclo de flujo puede ser válido; los ciclos
  prohibidos son solo los del grafo de dependencias del núcleo.
- **Validación.** Autoritativa en `ruth-meta` (`design.rs`): tipos,
  límites, identificadores únicos, referencias existentes, cardinalidades
  admitidas y pertenencia al conjunto. El contenido guardado es el JSON
  canónico; Mermaid se deriva con un serializador determinista que escapa
  etiquetas (sin HTML, scripts, directivas ni enlaces del modelo).
- **Renderizado.** Local, sin API: Mermaid cargado bajo demanda con
  `securityLevel: strict`, sintaxis validada y errores contenidos sin
  romper la app. La interfaz muestra diagrama, fuente Mermaid de lectura,
  fuentes, explicación y preguntas, aclarando que sintaxis válida no
  garantiza corrección del diseño.
- **Revisión.** Editar revalida y vuelve a renderizar, conservando el
  último resultado válido. "Aceptar como borrador" crea el artefacto
  (`flujo-N`/`mer-N`) o una nueva versión con la versión esperada,
  atómica e idempotente, sin aprobar. Aprobar exige confirmación humana,
  sin ediciones pendientes, contenido validado y renderizado, y revalidar
  vigencia y versión actual en Rust.
- **Dependencias.** Exactas a las versiones utilizadas. Fuente cambiada
  durante la generación → propuesta desactualizada con aceptación
  bloqueada; después de aceptar → el núcleo calcula revisión pendiente.
  Respuestas tardías filtradas por módulo y clave de montaje.
- **Persistencia.** Esquema v3 con migración transaccional desde v1/v2:
  generaciones, propuestas y procedencia de diseño; atomicidad
  dominio → base → UI y una generación simultánea por módulo, como en el
  hito 5. Clave solo en Rust; modelo y tokens visibles sin costos
  inventados.
- **Interfaz.** Funcionalidad `design` separada (tipos, cliente,
  coordinación, panel, detalle, diagrama): borradores locales,
  instantáneas de Rust y montaje por módulo. Zustand suma el diseño
  seleccionado y la vista central.

## 9. Mapa de impacto (hito 7)

Cambiar un requisito y ver el impacto real, sin llamadas a Meta: el núcleo
ya calculaba afectados, vigencia y caminos; este hito solo lo expone y lo
visualiza.

- **Consulta.** `ruth-api::impact_report` + comando `core_impact_report`
  (lectura con bloqueo corto, sin `transact`): origen con comparación
  Antes/Ahora (base elegible, por defecto la anterior), afectados con
  `requires_review` negado de la vigencia del núcleo, pines
  utilizada-frente-a-actual, aprobaciones de la actual +
  `approved_before`, y caminos completos. Determinista y sin mutar.
- **Distinciones.** Dependencia (relación registrada), impacto (el cambio
  alcanza por ella) y desactualización (la actual usa fuentes antiguas):
  un diseño actualizado sigue relacionado pero no pendiente, y un diseño
  aprobado históricamente muestra ambas cosas a la vez.
- **Vista.** Pestaña Impacto en el centro + inspector a la derecha:
  encabezado con requisito y versiones, Antes/Ahora, grafo, tabla
  paginada con el total completo y contador derivado de pendientes
  únicos. Entrar es un cambio puro de vista (no toca selección ni
  borradores); salir y navegar usan la protección habitual.
- **Grafo.** SVG propio de lectura en `src/features/impact`: trazado
  determinista por capas (`layout.ts`, probado), selección con clic y
  teclado, zoom con rueda/botones y ajuste al contenido; sin React Flow
  (sobredimensionado) y sin Mermaid (no da selección/zoom). Tope de 60
  nodos con aviso explícito; el arrastre solo desplaza la vista.
- **Inspector.** Por qué está afectado (todos los caminos, navegables),
  fuentes fijadas frente a actuales, diferencias del propio artefacto
  (historial real) y apertura del diseño/requisito. Sin chat ni
  reparación simulada.
- **Frescura.** Recalculo tras guardar, aceptar o aprobar; respuestas
  tardías filtradas por clave de consulta; contexto (origen, base, nodo)
  en el workspace para conservarlo al volver; zoom efímero sin persistir.
  Sin flags redundantes de impacto en ningún sitio.

## 10. Actualización de diseños pendientes (hito 8)

Desde Impacto hasta el borrador revisado, sin segundo sistema: las
propuestas de actualización viven en la misma tabla y ciclo que la
creación, fijando además el objetivo y su versión.

- **Snapshot.** `update_context_preview` (consultivo) y
  `snapshot_update_context` (autoritativo, `update_blocked` si hay
  motivos): objetivo con su diseño actual, fuentes con versión utilizada
  y actual más contenidos, cambio origen, caminos y bloqueos. Se conserva
  el conjunto de fuentes y se actualizan sus versiones; fuente actual sin
  aprobar o no vigente bloquea (la intermedia desactualizada se actualiza
  primero: sin saltar etapas).
- **Generación.** Comando `core_propose_design_update` con la misma
  disciplina que la creación (foto, marca por módulo, red sin bloqueos,
  registro posterior): prompt de ajuste (`build_update_input`, plantilla
  v1 de actualización), mismo esquema `text.format`, mismos límites y
  timeout. Si el objetivo o una fuente se mueve durante la red, la
  propuesta nace desactualizada y no se puede aceptar.
- **Comparación.** `core_design_diff` puro sobre dos especificaciones
  validadas: añadidos/eliminados/modificados de nodos, aristas,
  entidades, atributos y relaciones, orden determinista; los IDs
  cambiados son alta+baja, nunca equivalencias inventadas. La interfaz
  alterna diagramas actual/propuesto (Mermaid local y seguro), muestra el
  diff, las fuentes anteriores y nuevas, explicación y preguntas, y
  aclara que la explicación no es evidencia.
- **Aceptación.** Mismo `accept_design`: sobre el mismo artefacto y
  versión del snapshot, fuentes del snapshot todavía actuales, aprobadas
  y vigentes; procedencia IA, sin heredar aprobación; atómica (dominio +
  propuesta en una transacción) e idempotente; el descarte bloquea. Fallo
  de disco = nada a medias.
- **Impacto.** Tras aceptar se recalcula desde el núcleo: "pendiente de
  aprobación" (fuentes al día, sin aprobación actual) se distingue de
  "requiere revisión" en tabla, inspector y grafo; los demás pendientes
  se conservan. Ediciones JSON elevadas al workspace para no perderse al
  navegar; respuestas tardías filtradas por objetivo.
- **Persistencia.** Esquema v4: columnas de objetivo en
  `design_generations` (nulas en creaciones), migración transaccional e
  idempotente desde v1/v2/v3, carga tolerante a v3 y verificación de
  referencias del objetivo. Al reabrir, las propuestas se retoman con su
  diff.

## 11. Baseline aprobada y exportación reproducible (hito 9)

Cierre del recorrido de competencia: de lo aprobado a una entrega
verificable, sin IA en el camino. Todo lo exportable sale de la baseline,
nunca de `latest`.

- **Preparación.** `prepare_baseline` (consultiva, sin mutaciones):
  selección dentro de un módulo, cierre transitivo sobre versiones
  actuales exactas, aprobaciones, procedencia y bloqueos concretos
  (`draft`, `stale_sources`, `stale_expected`, `missing_sources`,
  `not_in_scope`), más el fuera de alcance. No promete proyecto
  aprobado si el alcance es un módulo.
- **Creación.** `create_baseline` revalida `changed_since_preview` y
  delega la coherencia al núcleo (`Store::create_baseline`); el actor
  persiste dominio + metadatos en una transacción y la API publica
  después. Sin parciales: ante conflicto o incoherencia, memoria, disco
  e IDs quedan intactos. El listado calcula `advanced` comparando con
  las versiones actuales.
- **Metadatos.** Tabla `baseline_meta` (esquema v5, migración
  transaccional e idempotente desde v1–v4): nombre, descripción, módulo
  del alcance y fecha. Sin FK hacia el dominio —mismo patrón que
  generaciones y diseños—, con verificación al cargar. La coherencia
  sigue viviendo en las tablas del dominio.
- **Paquete.** `build_export_files` resuelve cada entrada contra la
  versión fijada: README, `specification.md`, `manifest.json`
  (`ruth-baseline-export` v1, con SHA-256 por archivo salvo el propio
  manifiesto), `artifacts/` verbatim, `diagrams/` vía el serializador
  Mermaid existente (contenido no estructurado = comentario que apunta
  al original, nunca diagrama inventado) e
  `implementation-context.md` sin stack ni decisiones inventadas. Sin
  claves, SQLite, chats, respuestas crudas ni descartes.
- **Reproducibilidad.** Orden estable, nombres desde IDs saneados,
  rutas relativas seguras, límites (500 artefactos, 1 MiB/archivo,
  16 MiB total) y ZIP con fecha, permisos y compresión fijos: misma
  baseline + exportador = mismos bytes, verificado entre procesos.
- **Guardado.** Comandos `core_export_preview` (inventario sin
  contenido) y `core_export_save` (destino del diálogo nativo,
  `tauri-plugin-dialog` con permiso `dialog:default` y sin escritura
  general al frontend): existe + sin confirmación = `export_exists`;
  escritura en temporal hermano y renombre atómico con limpieza. El
  bloqueo del estado se suelta antes de tocar disco; cancelar no llega
  al comando.
- **Interfaz.** Botón Exportar en el encabezado y diálogo amplio con
  pestañas Preparar/Baselines: crear y guardar ZIP como acciones
  separadas, error que dice qué artefacto revisar, respuestas tardías
  filtradas por consulta y aviso de escritorio en navegador.

Corrección al pasar: el guardado completo vaciaba `projects` antes que
`baselines` (FK hija→padre); con baselines reales el segundo guardado
fallaba. Nunca se notó porque la tabla estaba vacía hasta este hito.
Cubierto con `repeated_saves_keep_baselines_and_meta`.

Recorrido de competencia completado: requisitos vinculados a flujo y ER →
cambio de regla → impacto → propuestas → aprobación → exportación.

## 12. Edición visual de diseños (hito 10)

Lienzo interactivo para editar flujos y modelos ER sin salir del
subconjunto del hito 6. El JSON estructurado sigue siendo autoritativo;
el lienzo es una vista editable derivada, y Mermaid sigue como vista y
fuente derivada para consulta, aprobación y exportación.

- **Tecnología.** React Flow (`@xyflow/react` v12) para ambos editores,
  en chunks diferidos (`DesignEditor` + `DesignCanvas`, con su CSS) que
  solo se descargan al abrir la pestaña de lienzo/editor. No se construyó
  un motor de interacción propio; el grafo de impacto (SVG de lectura)
  se conserva porque no necesita edición. Decisión documentada aquí por
  ser la primera dependencia grande de interacción del frontend.
- **Separación semántica/presentación.** `specModel.ts` (puro, sin
  React): parseo tolerante, serialización canónica con el mismo orden de
  claves que Rust, operaciones totales (crear/renombrar/eliminar nodos,
  aristas, entidades, atributos y relaciones) y trazado automático
  determinista (capas por anchura en flujos, rejilla en ER). Las
  posiciones viven en `Layout`, aparte: mover, zoom o desplazar jamás
  toca la especificación (cubierto por pruebas).
- **Subconjunto acotado y honesto.** El editor ofrece exactamente lo que
  el contrato representa: entidades con nombre/atributos (nombre + marca
  PK) y relaciones con cardinalidades. Tipos de atributo, obligatoriedad
  y FK por atributo NO se representan (fuera del subconjunto) y por eso
  no aparecen en la interfaz; documentado en el inspector y aquí, sin
  ampliar el contrato en este hito.
- **Borrador elevado.** El borrador (especificación + disposición +
  historial deshacer/rehacer acotado a 50 + fijaciones) vive en el
  workspace con `useReducer`, no en el lienzo: sobrevive a cambios de
  pestaña. Deshacer/rehacer cubre solo cambios semánticos, con
  Ctrl+Z/Ctrl+Y fuera de campos. Los borrados con consecuencias
  (aristas, atributos, relaciones) piden confirmación explícita; la tecla
  de borrado del lienzo está desactivada a propósito.
- **Validación en dos niveles.** Orientativa en frontend
  (`specValidation.ts`, espejo documentado de los topes de Rust, con
  avisos estructurales que no prohíben ciclos válidos) y autoritativa en
  Rust al guardar. Los errores bloquean el guardado; los avisos no.
- **Guardado manual versionado.** `core_save_design_version`: crea una
  versión del MISMO artefacto con procedencia humana (nunca IA), sin
  heredar aprobación, con versión esperada y fuentes declaradas
  explícitas que deben existir y estar vigentes; las obsoletas bloquean
  nombrando artefactos (`design_stale_sources`) y la persona adopta las
  actuales de forma explícita. La trazabilidad a la generación de origen
  se conserva por la cadena de versiones + el registro existente (sin
  tabla nueva). La disposición viaja en la misma transacción; si solo se
  reordena, `core_save_design_layout` guarda únicamente disposición sin
  crear versiones vacías. La aprobación sigue exigiendo revisión
  explícita y revalidación en Rust, y se bloquea con ediciones
  pendientes.
- **Disposición persistida.** Tabla `design_layouts` (esquema v6,
  migración transaccional e idempotente): posiciones por artefacto y
  versión, higienizadas al guardar y tolerantes al leer (una fila
  ilegible equivale a "sin disposición", jamás rompe la apertura).
  Presentación pura: fuera del dominio, la vigencia y la exportación.
- **Navegación y guardia.** Cambiar de pestaña no pierde el borrador;
  abandonar el diseño con cambios (semánticos o de disposición) abre el
  diálogo con guardar/descartar/cancelar, encadenado tras el del
  requisito si ambos están sucios. Un conflicto de versión recarga la
  actual y conserva el borrador separado con su JSON para decidir.
  Guardar recalcula Impacto como las demás mutaciones.
- **Lienzo.** Zoom con rueda centrado en el cursor (0,2–2×), arrastre
  del fondo, botones acercar/alejar/ajustar/centrar-100 % con porcentaje
  (región viva), selección y movimiento de elementos, creación de
  conexiones arrastrando o con formularios equivalentes por teclado, y
  modo lectura para históricas (navegar y seleccionar, sin editar).
  Hallazgo de verificación: el ajuste inicial espera a nodos medidos
  (las dimensiones se devuelven al prop controlado) y es único; ni el
  prop `fitView` ni un `onInit` ciego sirven, porque compiten con la
  medición y arrebatan el zoom al usuario.

## 13. Archivo reversible y borrado seguro

Gestión de ciclo de vida para módulos y requisitos (los diseños solo se
archivan por contexto del módulo). Las reglas viven en `ruth-core`; la
interfaz resume, confirma y respeta; Rust revalida al ejecutar.

- **Modelo.** `Module.archived` y `Artifact.archived` reversibles. El
  archivado efectivo de un artefacto es su flag o el de su módulo, y se
  calcula en cada consulta (sin flags redundantes). Archivar un módulo
  no toca archivos individuales; restaurarlo no los restaura.
- **Qué bloquea el núcleo.** Crear artefactos en módulos archivados;
  nuevas versiones, borradores IA y aprobaciones sobre archivados
  efectivos; aprobar versiones con fuentes archivadas (`ArchivedSource`,
  antes que la vigencia: restaurar puede bastar); baselines con entradas
  o fuentes archivadas. Todo llega a diseños, propuestas y entregas
  porque esos caminos reutilizan los mismos casos de uso.
- **Generaciones.** No se genera sobre archivados: los contextos
  excluyen requisitos archivados y `record_*` revalida el módulo (pudo
  archivarse durante la red). Aceptar en un módulo archivado falla en
  `create_artifact`. Los previos de baseline y actualización muestran
  bloqueos honestos (`archived`, `archived_source`, `target_archived`,
  `source_archived`); el snapshot de actualización ya fallaba con
  bloqueos, así que la protección es autoritativa también ahí.
- **Borrado.** Solo sin referencias: el núcleo exige cero aprobaciones,
  cero dependientes de otros artefactos y cero baselines (errores
  tipados que nombran qué lo impide) y módulo vacío; la API exige además
  cero menciones en generaciones (propias, contexto, aceptación,
  objetivo) y no ser alcance de baselines. Sin cascadas silenciosas, sin
  desactivar claves foráneas, sin reescribir historial: si algo lo
  referencia, se bloquea y se recomienda archivar. Los borradores creados
  por IA aceptada no se eliminan (su propuesta los referencia): se archivan.
- **Resumen previo.** `core_archive_preview` es consultivo: contenido,
  dependientes con su módulo (dentro/fuera), baselines con nombre,
  generaciones con rol, aprobaciones y versiones, más `can_delete` con
  bloqueos. La ejecución revalida todo dentro de la misma sección
  crítica que la mutación.
- **Persistencia.** Esquema v7: columnas `archived` con defecto 0
  (migración idempotente; lo existente sigue activo). Guardar y cargar
  llevan los flags; un valor distinto de 0/1 se rechaza como
  manipulación sin sobrescribir. Archivo, restauración y borrado pasan
  por `transact` (validar → persistir → publicar).
- **Interfaz.** Menú "…" por fila, interruptor «Mostrar archivados» de
  sesión, insignias y filas atenuadas, vacíos honestos («Sin requisitos
  (2 archivados)»), diálogo con resumen y confirmación explícita con
  nombre. Lo archivado se consulta (historial, generaciones, diagramas)
  pero no se edita, genera ni aprueba. Con borrador sucio, el diálogo de
  guardar/descartar/cancelar precede al resumen (encadenado
  requisito→visual); tras eliminar se limpia la selección incompatible;
  ante un fallo se conserva todo; las respuestas tardías se ignoran por
  época. Las baselines históricas siguen consultables y exportables.

## 14. Renombrado de proyectos, módulos, requisitos y diagramas

Nombres organizativos (proyecto, módulo) y títulos metadato (requisito,
diagrama). Renombrar no toca IDs, reglas, fuentes, relaciones ni contenido:
no invalida aprobaciones ni crea impactos. La identidad es el ID; los
duplicados se permiten y se desambigua con contexto o ID.

- **Modelo.** `Name` validado (recorte, no vacío, ≤120 caracteres). El
  título vive en `Artifact.title` (`Option`, separado del contenido) y su
  historial en `TitleChange { artifact, title, by, at }` (firma humana).
  Sin título propio, la UI deriva la primera línea como presentación,
  sin tocar el dominio ni llamar a IA.
- **Concurrencia.** Cada renombrado recibe la revisión esperada
  (`expected_name` / `expected_title`, `None` = aún sin título) y Rust
  rechaza con `stale_name` si cambió fuera. Elementos archivados no se
  renombran sin restaurar (`Archived*`, antes que el resto).
- **Baselines.** Al crearla, cada entrada fija el título vigente
  (`Baseline.titles`, `title_of`); las históricas son inmutables y nunca
  consultan `latest`. Las nuevas capturan los nombres vigentes. La
  exportación usa el título fijado en `specification.md`,
  `implementation-context.md` y `manifest.json` (`entries[].title`); los
  nombres de archivo siguen saliendo de IDs seguros. Nombres de
  proyecto/módulo no se fijan en la baseline y no se exportan.
- **Persistencia.** Esquema v8: columnas `name`/`title` y tabla
  `title_history` (migración idempotente v7→v8; lo existente conserva ID
  como nombre y `NULL` como título). Guardar y cargar llevan nombres e
  historial; valores inválidos se rechazan sin sobrescribir. Todo pasa
  por `transact` (validar → persistir → publicar).
- **Interfaz.** Acción «Renombrar» en el menú «…» del árbol (los cuatro
  tipos) y en el detalle de requisito y diagrama. Diálogo pequeño con
  nombre actual, Guardar/Cancelar, Enter/Escape, validación orientativa
  y autoría para el historial de títulos. Renombrar no pide guardar
  borradores (no toca contenido) ni los pierde; ante un fallo conserva
  el nombre anterior y permite reintentar; las respuestas tardías se
  ignoran por época. Árbol, miga de pan, encabezados, selectores,
  inspectores, mapa de impacto y baselines muestran el nombre con el ID
  como secundario o tooltip. Hallazgo: el tipo TS del detalle histórico
  era plano pero Rust sirve entradas anidadas (celdas vacías en
  runtime); se realineó al anidado y la tabla histórica distingue el
  título fijado del vigente.

## 15. Diseño vivo (etapa A: guardar sin barreras)

Decisión de producto autorizada (ver
[decisión de diseño vivo](decision-diseno-vivo.md)): guardar, generar y
continuar diseñando no requieren aprobación. La revisión es opcional e
informativa; la IA nunca sobrescribe silenciosamente contenido manual.
Las aprobaciones y baselines históricas conservan su significado
original: la etapa A no relaja retroactivamente sus invariantes.

- **Política.** Generar y actualizar parten de versiones actuales
  guardadas, sin exigir aprobación (`snapshot_design_context` sustituye
  a la antigua selección que pedía aprobación; se eliminaron los
  errores `not_approved`/`source_not_approved`). «Desactualizado»
  significa «requiere sincronización», no prohibición. Siguen
  vigentes: identidades, versiones exactas, procedencia, conflictos de
  concurrencia, validación estructural y bloqueos estructurales
  (referencias inexistentes, contenido inválido, errores de disco).
- **Ctrl+S central.** `resolveSaveTarget` (puro, probado) elige el
  editor activo (requisito, flujo o datos; mockup llega en la etapa B); el atajo global y
  el botón Guardar emiten `saveSignal` y cada editor guarda por su
  flujo transaccional. Sin cambios no se crean versiones idénticas;
  un fallo conserva el borrador; las respuestas tardías no cambian el
  documento. En diálogos, Ctrl+S no hace nada pero evita el diálogo
  del WebView.
- **Vistas derivadas.** JSON → lienzo/Mermaid/impacto se recalcula
  localmente sin API. La auto-actualización con IA es opcional por
  módulo/sesión, desactivada al inicio: debounce 2,5 s que agrupa
  guardados (solo el último pendiente), una ejecución por módulo,
  máximo 5 propuestas por ciclo, desde versiones persistidas, sin
  recursión (sus resultados nunca programan otra ejecución). Los
  resultados van a propuestas separadas en Impacto; si Meta falla, el
  guardado sigue siendo exitoso. Tokens mostrados cuando existen.
- **Entregas de trabajo.** Nuevo `WorkDelivery` (`entrega-N`) al lado
  de `Baseline`: alcance, versiones guardadas, revisiones opcionales
  y desactualizaciones identificadas; jamás se presenta como
  «coherente» o «verificada» (hay un test que lo vigila). Títulos
  fijados al crear, como las baselines. Exportación ZIP reutilizando
  el ensamblador (`ExportKind::{ApprovedBaseline, WorkDelivery}`):
  las baselines salen byte-idénticas a antes; las entregas añaden
  `kind: "work_draft"`, `stale_sources` y conteos de pendientes.
  Esquema v9 (`work_deliveries`, `work_delivery_entries`).
- **Interfaz.** El diálogo Entregas abre por defecto en «De trabajo»
  (preparar/crear/listar/exportar) con un modo «Aprobada» para
  baselines. «Revisar» se presenta como opcional; el estado de
  Impacto distingue «al día», «sin revisar», «fuentes obsoletas».

## 16. Mockups como artefactos de primera clase (etapa B)

Dibujos versionados hechos por una persona, al mismo nivel que
requisitos, flujos y ER: con identidad estable, versiones, fuentes
exactas, procedencia y revisiones opcionales (diseño vivo). Un mockup
nunca se presenta como diseño real: la vista distingue borrador de
revisado, y generar flujo/ER desde mockups produce propuestas
revisables, no verdades.

- **Modelo.** `ArtifactType::Mockup` en núcleo, store, API, exportación,
  impacto y actualización. El contenido autoritativo es un JSON canónico
  (`ruth-meta/src/mockup.rs`, contrato probado): pantallas con
  identidad estable y componentes `text | field | selector | button |
  table`. Topes documentados: 12 pantallas, 40 componentes, 24
  opciones, 12 columnas, 8 citas por elemento; títulos y etiquetas
  acotados en caracteres. IDs de componente únicos dentro del mockup.
- **Semántica frente a disposición.** Posición y tamaño viven aparte,
  en `design_layouts` (genérica, con `w/h` opcionales); mover o
  redimensionar no crea versiones ni toca revisiones. El lienzo usa los
  mismos guardias de época que el resto (`shouldApplyResponse`).
- **Origen de cada campo.** Todo campo/selector declara su origen:
  `persisted | calculated | temporary | external | undefined`. Un
  campo visual no implica una columna de base de datos: nada crea
  tablas ni atributos por suposición. Las citas a requisitos y diseños
  son informativas (se muestran con excerpt), no dependencias del
  núcleo; las dependencias de generación, exactas y sin ciclos, se
  declaran aparte y se adoptan explícitamente.
- **Editor.** Vista Mockups con paleta pequeña, lienzo (React Flow
  diferido, nodos declarativos sin HTML/JS de terceros) e inspector.
  Borrador elevado con deshacer/rehacer semántico, validación
  orientativa en frontend y autoritativa en Rust, Ctrl+S central
  (semántico o solo-disposición según lo que cambió) y confirmación al
  navegar con cambios. Eliminar con consecuencias pide confirmación;
  renombrar un componente reasigna su disposición. Las versiones
  históricas se consultan en lectura.
- **Diseño desde mockups.** El panel de diseño mezcla requisitos y
  mockups guardados como fuentes; con mockups usa
  `core_generate_design_from_mockups` (plantilla
  `DESIGN_MOCKUP_TEMPLATE_VERSION=1`; la de requisitos sigue en
  `DESIGN_TEMPLATE_VERSION=2`). Los mockups viajan como resumen
  legible (pantallas, componentes, orígenes, citas), sin posiciones.
  Desde el detalle de un mockup se abre el diálogo con ese mockup
  premarcado; también se puede generar solo desde mockups, señalando
  la información faltante en preguntas y supuestos. La aceptación
  reutiliza el circuito de propuestas de diseño (misma tabla de
  generaciones, mismo diff, misma atomicidad); la propuesta conserva
  su contexto y caduca si una fuente cambia.
- **Persistencia.** Sin migración nueva: el esquema sigue en v9 porque
  `kind` ya es texto libre y las tablas de versiones, disposiciones,
  generaciones y entregas son genéricas. Las bases anteriores se abren
  intactas; los mockups se guardan y recuperan con el mismo ciclo
  validar → persistir → publicar.
- **Exportación e impacto.** Las entregas y baselines incluyen los
  mockups de su alcance como JSON autoritativo más un resumen legible
  (sin diagramas inventados); las históricas salen byte-idénticas. El
  impacto deriva vínculos de las fuentes exactas registradas,
  distinguiendo directo de transitivo.

## 17. Terminal integrada (PTY real)

Panel inferior con sesiones de shell de verdad, para shells, agentes de
programación, servidores y Git. Nada se simula: si algo falla, falla a la
vista con su error.

- **Rust (`ruth-term`, `portable-pty`).** `TerminalManager` abre hasta 3
  PTYs con un hilo lector dedicado por sesión (fuera del hilo de
  interfaz). Los IDs (`term-N`, monótonos) los genera Rust; el shell
  (`$SHELL` o `/bin/sh`; PowerShell en Windows) se lanza como proceso
  con programa y argumentos separados. La interfaz no elige programas:
  `term_create` solo recibe carpeta inicial y tamaño.
- **Eventos.** La salida viaja por `ruth-terminal-output` en fragmentos
  de 8 KiB decodificados a UTF-8 incremental (multibyte partido
  recompuesto, inválido sustituido); el fin por `ruth-terminal-exit`
  con el código real. Cerrar la ventana con sesiones en marcha frena
  el cierre (`CloseRequested` + `prevent_close`) y emite
  `ruth-terminal-close-requested`; `term_quit_app` mata las sesiones y
  sale. Todo con permisos Tauri mínimos (comandos propios + diálogo).
- **Entorno depurado.** El hijo hereda el entorno menos la familia
  `META_*` (`scrub_env`, probada pura y de punta a punta con `env`).
  Sin secretos en mensajes, registros, SQLite ni historial de Ruth.
- **Interfaz (`features/terminal`).** xterm.js 6 + FitAddon por sesión,
  siempre montadas (ocultar conserva scrollback, acotado a 2000
  líneas); la salida entra directa a xterm sin estado React.
  Redimensionado con antirrebote que avisa al PTY (`SIGWINCH`),
  pegados troceados a 60 KiB, Ctrl+S eximido dentro del panel (es XOFF
  del PTY), copiar/pegar con Ctrl+Mayús+C/V, carpeta inicial por
  diálogo nativo (las abiertas conservan la suya) y confirmaciones
  para cerrar sesión en marcha y para salir de la app. Las
  suscripciones usan un colector que da de baja incluso lo resuelto
  tras desmontar (fue la causa del prompt duplicado en dev).
  Pestañas y paralelo son la misma estructura con distinto CSS, con
  claves estables: alternar no desmonta vistas ni pierde salida.
- **Ciclo de vida.** Cerrar mata al hijo, espera su fin (~1 s máx.),
  recoge el hilo y suelta el PTY; limpiar solo borra la vista. Nada de
  terminal se persiste ni se restaura al reabrir.

## 18. Encabezado honesto y Asistente Meta

Refino de presentación sin tocar servicios de IA, propuestas ni
persistencia: guardar y generar siguen sin requerir aprobación.

- **Estado por documento.** Cada editor publica su estado (`docStatus`
  en el store: `req/design/mockup:{id}` → sucio, guardando, error,
  etiqueta). El encabezado deriva el documento activo de selección +
  vista y cuenta los demás aparte; jamás un flag global. Los
  reductores comparan contra lo guardado (re-escribirlo limpia) y los
  resultados llevan generación/instantánea: lo editado durante una
  petición sobrevive al resultado anterior (en diseños/mockups queda
  marcado como separado para el conflicto, nunca se pierde).
- **Exportar con borradores.** Si hay borradores, una puerta explica
  que el paquete solo incluye versiones persistidas y ofrece guardar
  todo y continuar (secuencial, por flujos transaccionales, sin
  inventar autoría), exportar lo guardado o cancelar. Sin descartes.
- **Asistente Meta.** Columna derecha con pestañas Revisión/Asistente
  (redimensionable con tirador y teclado, ocultable; sin ella el
  centro gana el ancho). Contexto visible (módulo, artefacto, versión)
  y aviso de borradores fuera del contexto. Tres acciones explícitas
  que montan los paneles existentes (propuestas, diseño, actualización
  desde el informe de impacto vigente); las áreas usadas se conservan
  montadas para no perder generaciones en curso ni reasignar
  propuestas al cambiar de selección. Historial combinado y acotado
  (8), bajo demanda; compositor cuyo texto solo alimenta Proponer
  requisitos (las demás acciones lo ignoran avisando). Sin llamadas al
  abrir ni al escribir; modelo y tokens a la vista.
- **Encabezado.** Marca + contexto a la izquierda; estado, Guardar,
  Exportar (menta, con motivo visible al deshabilitar) y menú ⋯
  (Conexión) a la derecha; responsive sin solapamientos.

## 19. Densidad compacta y ventana sin decoración

Refino visual sin cambios de funcionalidad, lógica ni persistencia.

- **Densidad.** Radios al 50 % mediante tokens (`--r-xs/sm/md/lg`,
  2/3/4/5 px; los modismos 999px/50 %/0 se conservan), espaciados
  (padding/margin/gap) al 50 % y bordes ya en el mínimo de 1 px (los
  indicadores de pestaña pasan de 2 a 1 px y el acento de aviso de 3
  a 2 px). Lienzos, nodos, handles y separadores conservan sus
  dimensiones; los botones mantienen áreas ≥ 24 px.
- **Tipografía.** −2 px por categoría con suelo de 12 px (lo que ya
  estaba por debajo sube al mínimo); base del body a 14 px, misma
  altura de línea. La terminal (13 px) y el zoom de diagramas no
  cambian; los títulos del árbol conservan tooltip completo.
- **Ventana.** `decorations: false` con tamaño mínimo 880×600. El
  encabezado integra minimizar/maximizar-restaurar/cerrar tras el
  menú ⋯, con permisos mínimos (`minimize`, `toggle-maximize`,
  `is-maximized`, `close`, `start-dragging`); cerrar solo se tiñe de
  rojo al interactuar. La zona de arrastre es el espacio libre del
  contexto (doble clic maximiza); botones, campos y menús no
  arrastran. Cerrar pasa por la puerta de borradores (guardar todo,
  cerrar sin guardar explícito, cancelar) y luego por el `close()`
  normal, que aún frena ante terminales activas; sin salidas
  forzadas. En navegador no hay controles nativos.
