# Arquitectura — Ruth IDE

## 1. Horizonte

**Visión completa.** Espacio de trabajo visual que recorre el ciclo entero:
requisitos → diseño → arquitectura → implementación → verificación → code
review, con artefactos vinculados, impacto ante cambios y aprobación humana.

**Objetivo de competencia.** Un recorrido reducido pero completo: requisitos
vinculados a flujo y ER → cambio de regla → impacto → propuestas → aprobación
→ exportación de versiones aprobadas.

**Hito actual (hito 6).** Diseño vinculado a requisitos (flujo o ER)
generado con Meta y distribución visual inspirada en el mockup: seleccionar
requisitos aprobados, generar una propuesta estructurada, visualizarla con
Mermaid local, revisarla y aceptarla como borrador con dependencias exactas.
La aprobación sigue siendo humana. Ver [alcance](alcance-hackathon.md).

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
- **Esquema.** v3 en `schema.rs`, con `user_version` y migraciones
  transaccionales e idempotentes (v1→v2→v3 añaden tablas de generaciones
  y de diseño). Conserva tipos de artefacto y baselines aunque no tengan
  pantalla. No guarda claves, borradores ni selección.
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

Siguiente hito propuesto: mapa interactivo de impacto ante cambios de
reglas (cambio → afectados y caminos → propuestas de actualización →
aprobación → exportación), avanzando hacia el objetivo de competencia.
