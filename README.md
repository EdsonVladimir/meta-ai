# Ruth IDE — Densidad compacta y ventana propia

Espacio de trabajo visual que transforma requisitos en artefactos de diseño
vinculados. Cuando cambia una regla, identifica dependencias afectadas y propone
ajustes que una persona revisa.

Este hito refina el encabezado (estado real de guardado por documento,
Exportar con puerta honesta ante borradores) e integra el panel Asistente
Meta, que reutiliza los flujos IA existentes con acciones explícitas, sin
clasificador silencioso. Sobre la base de diseño vivo (etapa B: mockups
versionados; etapa A: guardar sin barreras, revisión opcional, entregas de
trabajo). Sin IA silenciosa y sin relajar baselines. Las reglas viven en
`ruth-core`, la ejecución revalida en Rust y todo viaja en transacciones. Ver
[docs/alcance-hackathon.md](docs/alcance-hackathon.md) para el alcance de
competencia, [docs/decision-diseno-vivo.md](docs/decision-diseno-vivo.md)
para la decisión y [docs/arquitectura.md](docs/arquitectura.md) para el
diseño.

> Los datos confirmados se guardan en `ruth.db` dentro del directorio de
> datos de la aplicación (Linux: `~/.local/share/ide.ruth.app/`;
> macOS: `~/Library/Application Support/ide.ruth.app/`;
> Windows: `%APPDATA%\ide.ruth.app\`). Los borradores sin guardar siguen
> viviendo solo en memoria y no sobreviven al cierre.

## Requisitos

- Node.js 18+ (probado con Node 24) y npm.
- Rust estable (probado con 1.97) y Cargo.
- En Linux, dependencias de sistema de Tauri 2 (ver
  [prerrequisitos oficiales](https://v2.tauri.app/start/prerequisites/)):
  `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`,
  `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
- Una clave de Meta Model API (solo para la prueba real; ver abajo).

## Instalación

```sh
npm install
```

## Ejecución

Interfaz web de desarrollo (sin comandos nativos: la prueba mostrará que
requiere Tauri):

```sh
npm run dev
```

Aplicación de escritorio (compila Rust y abre la ventana nativa):

```sh
npm run tauri dev
```

Compilación web de producción:

```sh
npm run build
```

## Variables de entorno (sin dejar la clave en el historial)

La prueba lee **solo** el entorno del proceso nativo. Nunca pongas la clave
como argumento en la línea de comandos ni en archivos del repo.

Opción recomendada (la clave no queda en el historial ni en pantalla):

```sh
read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo
```

Variables:

| Variable      | Obligatoria | Efecto                                              |
| ------------- | ----------- | --------------------------------------------------- |
| `META_API_KEY`| Sí          | Clave de Meta Model API. Sin ella no hay petición.  |
| `META_MODEL`  | No          | Modelo a usar. Por defecto `muse-spark-1.3`.        |

Lanza después, en la misma sesión:

```sh
npm run tauri dev
```

Al terminar, puedes limpiar la variable con `unset META_API_KEY`.

Notas:

- `read -s` no muestra lo que escribes y, al no pasar la clave como argumento,
  no queda en `~/.bash_history`.
- No uses `export META_API_KEY=sk-...` directamente: la clave sí quedaría en
  el historial.
- No existe archivo `.env`: el frontend no lee entorno y el backend solo lee
  el del proceso.

## Qué está implementado (densidad y ventana)

- Densidad compacta: radios y espaciados al 50 %, bordes en 1 px,
  tipografías −2 px con mínimo de 12 px. Lienzos, nodos, terminal y
  áreas de interacción intactos.
- Ventana sin barra nativa: controles en el encabezado (minimizar,
  maximizar/restaurar, cerrar con rojo solo al interactuar), arrastre
  desde el espacio libre y doble clic para maximizar. Cerrar avisa
  por borradores (guardar todo, cerrar sin guardar, cancelar) y
  respeta el freno por terminales activas.

## Qué estaba implementado (asistente y encabezado)

- Encabezado: marca + contexto a la izquierda; estado de guardado,
  Exportar (compacto, borde menta) y menú ⋯ (con Conexión) a la derecha.
- Estado real por documento: sin documento, cambios sin guardar (ámbar),
  guardando, guardado o error con reintento; contador aparte de otros
  con borrador. Lo editado durante un guardado sobrevive al resultado
  anterior; re-escribir lo guardado limpia; la disposición no se
  presenta como cambio semántico.
- Exportar con borradores abre una puerta honesta: guardar todo y
  continuar, exportar lo guardado o cancelar. El paquete solo incluye
  versiones persistidas.
- Asistente Meta: columna derecha con pestañas Revisión/Asistente
  (redimensionable, ocultable), contexto visible, tres acciones
  explícitas que reutilizan los flujos existentes, historial acotado
  bajo demanda y compositor. Sin clasificador: el texto solo alimenta
  Proponer requisitos.

## Qué estaba implementado (diseño vivo, etapa B)

- Mockups versionados: pantallas con identidad estable; componentes
  texto, campo, selector, botón y tabla; disposición separada de la
  semántica (mover no versiona); origen declarado por campo
  (persistido, calculado, temporal, externo o sin definir).
- Editor visual: vista Mockups con paleta, lienzo e inspector; zoom,
  deshacer/rehacer, Ctrl+S, validación orientativa y autoritativa en
  Rust, y versiones históricas en lectura.
- Diseño desde mockups: fuentes mixtas requisitos + mockups (resumen
  legible, sin posiciones) con Meta; reutiliza propuestas, diff y
  aceptación atómica de diseño. Generar solo desde mockups señala
  faltantes en vez de inventar certezas.
- Sin migración nueva (esquema v9) y exportación que incluye los
  mockups del alcance como JSON más resumen; baselines históricas
  byte-idénticas.

## Qué estaba implementado (diseño vivo, etapa A)

- Sin barreras de aprobación: generar y actualizar parten de versiones
  guardadas; «desactualizado» significa «requiere sincronización».
  Identidades, versiones exactas, procedencia y conflictos intactos.
- Ctrl+S central (y botón Guardar) al editor activo: requisito, flujo,
  datos o mockup. Sin cambios no crea versiones; un fallo conserva el
  borrador; las respuestas tardías no cambian el documento.
- Vistas derivadas locales sin API; auto-IA opcional por módulo
  (desactivada al inicio): debounce 2,5 s, una ejecución por módulo,
  máximo 5 propuestas por ciclo, sin recursión, a propuestas separadas.
- Entregas de trabajo/borrador (`entrega-N`) con títulos fijados,
  pendientes y fuentes obsoletas a la vista, exportables a ZIP
  reproducible (esquema v9). Las baselines siguen intactas y salen
  byte-idénticas. El diálogo Entregas abre en «De trabajo».

## Qué estaba implementado (renombrado)

- Acción «Renombrar» en el menú «…» del árbol (proyectos, módulos,
  requisitos y diagramas) y en el detalle de requisito y diagrama:
  diálogo pequeño con nombre actual, Guardar/Cancelar y Enter/Escape.
- Nombres no vacíos de hasta 120 caracteres; duplicados permitidos (la
  identidad es el ID). Revisión esperada con rechazo `stale_name`; sin
  renombrar archivados sin restaurar. Sin HTML ni rutas desde títulos.
- Títulos con historial firmado por una persona; sin título propio, la UI
  deriva la primera línea sin tocar el dominio. Renombrar no invalida
  revisiones, no crea impactos y no pierde borradores.
- Baselines nuevas capturan los títulos vigentes; las históricas
  conservan los suyos y se exportan sin consultar `latest` (esquema v8).
  Nombres de proyecto/módulo no se fijan ni se exportan.
- Nombres visibles en árbol, miga de pan, encabezados, selectores,
  inspectores, mapa de impacto y baselines, con el ID como secundario o
  tooltip. La tabla histórica distingue título fijado y vigente.

## Qué estaba implementado (archivo y borrado)

- Menú "…" en módulos y requisitos con archivar, restaurar y eliminar
  definitivamente; resumen consultivo previo (contenido, dependientes
  dentro/fuera del módulo, baselines, generaciones) y confirmación
  explícita con nombre. La ejecución revalida en Rust.
- Archivo reversible: oculta de las listas activas (interruptor «Mostrar
  archivados»), conserva versiones, aprobaciones, dependencias, baselines
  y generaciones, y bloquea ediciones, generaciones y aprobaciones hasta
  restaurar. El historial sigue consultable.
- Borrado solo cuando nada lo mencione: módulos vacíos sin generaciones
  ni alcance de baselines; requisitos borrador sin aprobaciones,
  dependientes, baselines ni menciones. Sin cascadas; si algo lo
  referencia, se bloquea y se recomienda archivar (esquema v7).

## Qué estaba implementado (hito 10)

- Lienzo interactivo con React Flow (cargado bajo demanda, solo al abrir
  el editor): zoom con rueda centrado en el cursor, desplazamiento por
  arrastre, botones acercar/alejar/ajustar/centrar-100 % con porcentaje
  anunciado, selección y movimiento de elementos, conexiones por
  arrastre o por teclado, y modo lectura en versiones históricas.
- Editor de Datos: entidades, atributos (nombre y PK) y relaciones con
  cardinalidades mediante inspector y confirmaciones de borrado con
  consecuencias. Editor de Flujos: pasos, decisiones, inicio/fin,
  etiquetas de ramas, citas a requisitos y avisos sin prohibir ciclos.
  Solo lo que el contrato representa: sin tipos, obligatoriedad ni FK
  por atributo.
- Borrador elevado con deshacer/rehacer semántico y validación
  orientativa inmediata; guardado como nueva versión humana
  (`core_save_design_version`) con versión esperada, fuentes vigentes
  declaradas y disposición en la misma transacción, o solo-disposición
  (`core_save_design_layout`) si no hubo cambios semánticos. Sin
  aprobaciones heredadas y con recálculo de Impacto.
- Protección del trabajo: el borrador sobrevive a pestañas, la
  navegación pide guardar/descartar/cancelar, los conflictos conservan
  el borrador separado y la aprobación se bloquea con ediciones
  pendientes. Reabrir conserva contenido y disposición (esquema v6).

## Qué estaba implementado (hito 9)

- Botón **Exportar** en el encabezado con diálogo amplio de entregas:
  pestaña **Preparar entrega** (módulo del alcance, artefactos elegibles,
  vista previa con versiones exactas, cierre de dependencias, aprobaciones,
  bloqueos concretos y fuera de alcance) y pestaña **Baselines** (listado
  con detalle y exportación histórica).
- Preparación consultiva sin mutaciones: la creación revalida en Rust
  dentro de la transacción y, si el proyecto cambió desde la vista previa,
  informa el conflicto sin crear otra entrega (`changed_since_preview`).
- Creación humana explícita con nombre y descripción opcional: guarda
  identidad, formato, proyecto, alcance, fecha, versiones exactas,
  dependencias, aprobaciones y procedencia. Lo que cambia después no
  altera la baseline; el listado señala si el proyecto avanzó.
- ZIP reproducible generado con código local, sin IA: `README.md`,
  `specification.md`, `manifest.json` versionado con SHA-256 por archivo
  (el manifiesto se excluye para no autorreferenciarse), `artifacts/` con
  el contenido original, `diagrams/` con Mermaid del serializador
  existente e `implementation-context.md` sin stack ni decisiones
  inventadas. Sin claves, SQLite, chats ni propuestas descartadas.
- Reproducibilidad: solo desde la baseline (nunca `latest`), orden
  estable, rutas seguras derivadas de IDs, límites de tamaño/cantidad y
  metadatos ZIP normalizados (misma baseline + exportador = mismos
  bytes). Los hashes verifican integridad, no son firma digital.
- Guardado seguro: diálogo nativo para elegir destino (plugin
  `tauri-plugin-dialog`, sin escritura general al frontend), cancelar no
  escribe ni informa éxito, confirmación antes de reemplazar, temporal y
  renombre atómico con limpieza ante fallos. Crear la baseline y guardar
  el ZIP son pasos separados y distinguibles.
- Persistencia v5 con migración transaccional e idempotente desde
  v1–v4 (tabla `baseline_meta` sin FK, como generaciones y diseños);
  la baseline histórica se exporta aunque ya no sea actual. Corregido el
  orden de borrado hijo→padre en el guardado completo (con baselines
  reales, vaciar `projects` antes que `baselines` violaba la FK).

## Qué estaba implementado (hito 8)

- Acción **Proponer actualización** en el inspector de un diseño pendiente:
  vista previa del snapshot (objetivo, diseño actual, fuentes con sus dos
  versiones, cambio origen, caminos y bloqueos), generación explícita para un
  diseño por vez, y revisión con comparación.
- Bloqueos honestos antes de generar: sin fuentes aprobadas no hay
  generación; si una fuente de diseño sigue desactualizada, hay que
  actualizarla primero (la cadena se resuelve en orden, sin saltar etapas).
- Mismo sistema de generaciones (sin duplicarlo): mismo esquema de salida,
  validación y Mermaid; el registro fija además objetivo y versión, y la
  aceptación exige ambos inmóviles más fuentes aprobadas y vigentes.
- Comparación: diagramas actual/propuesto alternables, diff estructural
  determinista (nodos/aristas o entidades/atributos/relaciones añadidos,
  eliminados y modificados), fuentes anteriores y nuevas, explicación y
  preguntas. La explicación no sustituye al diff.
- Editor JSON de la propuesta con revalidación, re-render y re-diff;
  ediciones conservadas al navegar. Aceptar crea una versión del mismo
  artefacto con procedencia IA y fuentes exactas: atómico, persistido e
  idempotente, sin heredar aprobación. Descartar bloquea aceptar después.
- Si el diseño o una fuente cambia durante la generación o revisión, la
  propuesta se conserva desactualizada, se bloquea su aceptación y se ofrece
  generar de nuevo; ningún fallo deja versión creada con propuesta pendiente.
- Impacto distingue "pendiente de aprobación" (fuentes al día) de "requiere
  revisión", recalcula al aceptar y conserva los demás pendientes.
- Persistencia v4 con migración transaccional desde v1/v2/v3 (columnas de
  objetivo); al reabrir se recuperan las propuestas con su diff.

## Qué estaba implementado (hito 7)

- Consulta de impacto (`core_impact_report`): requisito y versión origen,
  comparación con una versión anterior elegible, dependientes directos e
  indirectos, fuentes utilizadas frente a actuales, caminos explicativos y
  estado calculado (vigente, requiere revisión, aprobación histórica). Todo
  lo calcula `ruth-core`; la consulta no muta ni persiste nada.
- Pestaña **Impacto** junto a Requisitos y Diseño: encabezado con requisito
  y cambio, comparación Antes/Ahora, mapa de dependencias, tabla de
  artefactos con paginación, inspector derecho y contador derivado de
  pendientes únicos.
- Grafo SVG propio de lectura (sin dependencias nuevas): selección, zoom,
  ajuste al contenido, nodos sin duplicar con todos los caminos en el
  inspector, truncado explícito a 60 nodos con la tabla completa aparte, y
  texto e iconos además del color. Sin arrastre que modifique dependencias.
- Estados honestos: un diseño aprobado históricamente muestra su aprobación
  y su desactualización a la vez; lo ya actualizado sigue relacionado pero
  no pendiente. Sin checkboxes que "resuelvan" el impacto: solo una nueva
  versión revisada lo levanta.
- Inspector con acciones reales: Ver diferencias (historial propio del
  artefacto), Abrir diseño/requisito (navegación con protección de
  borradores) y Ver fuentes (fijadas frente a actuales). Sin chat ni
  reparación simulada.
- Recalculo tras guardar versiones, aceptar o aprobar diseños; respuestas
  tardías filtradas por consulta; contexto del mapa conservado al volver a
  la pestaña; el zoom es efímero y no se persiste.

## Qué estaba implementado (hito 6)

- Distribución inspirada en el mockup: tema oscuro con acentos menta y
  ámbar, encabezado compacto con proyecto/módulo y conexión plegable, raíl
  de paneles, izquierda con módulos y artefactos (requisitos + diseños),
  centro con vistas Requisitos/Diseño, derecha con generación, fuentes y
  revisión, y barra de estado con el guardado. Sin React Flow y sin
  simular el mapa de impacto.
- Generación de diseño por módulo y tipo: selector de flujo o ER,
  selección de requisitos aprobados con vista previa del contexto, botones
  independientes por tipo y aviso de envío a Meta. Sin regenerar al
  navegar.
- Subconjunto estructurado inicial validado en Rust (`ruth-meta`):
  flujo con nodos `start|step|decision|end` y aristas; ER con entidades,
  atributos y cardinalidades `1|0..1|N|0..N`; referencias dentro del
  conjunto enviado. Un ciclo de flujo es válido; no se confunde con los
  ciclos prohibidos del núcleo.
- Renderizado local a Mermaid con serializador determinista y etiquetas
  escapadas (el modelo no inyecta HTML ni scripts), carga bajo demanda y
  `securityLevel: strict`. Se muestra diagrama, fuente de lectura,
  fuentes, explicación y preguntas; sintaxis válida no garantiza
  corrección del diseño.
- Revisión con editor JSON validado: editar revalida y renderiza
  conservando el último resultado válido; "Aceptar como borrador" crea el
  artefacto (`flujo-N`/`mer-N`) o una nueva versión con la versión
  esperada, atómica e idempotente, sin aprobar. Aprobar exige
  confirmación humana, contenido validado y renderizado, y revalidación
  en Rust.
- Dependencias exactas a las versiones utilizadas; fuentes obsoletas
  bloquean la aceptación y el núcleo calcula la revisión pendiente tras
  aceptar. Respuestas tardías filtradas por módulo.
- Persistencia v3 con migración transaccional desde v1/v2 (generaciones,
  propuestas y procedencia de diseño); atomicidad dominio → base → UI y
  una generación simultánea por módulo, como en el hito 5.

## Qué estaba implementado (hito 5)

- Generación asistida por módulo: campo "Describe el módulo", vista previa
  del contexto que se enviará, botón "Proponer requisitos" y aviso de que el
  contenido viaja a Meta. Solo se envían la descripción y los requisitos
  actuales del módulo; nada de archivos, secretos u otros proyectos.
- Salida estructurada verificada en documentación oficial: Responses API con
  `text.format` (`type: "json_schema"`), plantilla de instrucciones v1 que
  pide señalar ambigüedades y no inventar decisiones como aprobadas.
- Validación autoritativa en Rust: campos, tipos, no vacío, temporales
  únicos, máximo 8 propuestas y 5 preguntas; lo inválido o incompleto se
  rechaza sin crear artefactos. Una generación simultánea por módulo, sin
  reintentos, con timeout, topes de entrada/respuesta y errores
  distinguibles (clave, facturación, rate limit, timeout, incompleta,
  inválida).
- Registro persistente de generaciones (esquema v2, migración transaccional
  que conserva las bases v1): identidad, proyecto/módulo, modelo,
  descripción, versiones exactas de contexto, plantilla, uso y preguntas.
- Caducidad calculada: si cambia una fuente, la generación se señala
  desactualizada y su aceptación se bloquea hasta generar de nuevo.
- Aceptación atómica e idempotente como borrador con procedencia IA
  (`accept_ai_draft`, sin fuentes, sin aprobación); ids definitivos de la
  app y aprobación humana posterior sin cambios.
- Interfaz: panel de generación con propuestas editables, preguntas
  separadas y acciones por propuesta; las guardadas se consultan al volver
  al módulo. En navegador se indica que se requiere escritorio.

## Qué estaba implementado (hito 4)

- Persistencia local con SQLite (`ruth-store`, adaptador separado del
  dominio): esquema versionado v2 con migración transaccional e idempotente,
  carga validante al arrancar y reescritura total por mutación (costo
  O(tamaño de la base), apta para el volumen del hackathon).
- Cada mutación es atómica: validar con el núcleo → persistir en
  transacción → publicar el estado; nunca se informa éxito antes de guardar
  (`ruth-api::transact`).
- Arranque degradado: si la base está corrupta, usa un esquema futuro o no
  puede abrirse, la app muestra un error recuperable sin borrar ni
  reemplazar nada (`core_status`).
- Escrituras serializadas fuera del hilo UI (actor con hilo dedicado) y
  segunda instancia detectada con error claro.
- Interfaz: banner "Persistencia local activa" con estado de guardado
  (borrador local / guardando / guardado / error); el borrador se conserva
  si falla el guardado.
- El núcleo revalida todo al cargar (`Store::reconstitute`): duplicados,
  pertenencia, ciclos, fuentes, orden de versiones, aprobaciones y baselines.
- No se guardan claves, borradores ni selección de paneles.

## Qué estaba implementado (hito 3)

- Espacio de requisitos con distribución de IDE: navegador (proyectos,
  módulos, requisitos), editor central y panel de revisión con historial.
- Crear proyecto y módulo; crear requisitos; editar como borrador local;
  guardar versiones nuevas; consultar anteriores en lectura; confirmar la
  revisión y aprobar la versión actual con autoría humana explícita.
- Frontera Tauri sobre `ruth-core` (`ruth-api` + comandos `core_*`): estado
  en memoria gestionado por Tauri, DTOs serializables y errores estables.
  El núcleo sigue sin Tauri, Serde, reloj ni red.
- Zustand solo para selección compartida y visibilidad de paneles;
  borradores en estado local e instantáneas autoritativas desde Rust.
- Protección del trabajo en memoria: aviso de sesión temporal, diálogo
  guardar/descartar/cancelar ante borradores sin guardar, y conservación
  del borrador ante errores de concurrencia.
- En navegador se informa que las operaciones del núcleo requieren
  escritorio; no se simula ningún guardado ni aprobación.

## Qué estaba implementado (hitos 1–2)

- Ventana de escritorio Tauri 2 con interfaz React + TypeScript + Vite.
- Marca Ruth IDE, descripción del producto y panel de conexión con estados
  `sin configurar / comprobando / disponible / error` y botón explícito
  **Probar conexión**.
- Comando nativo `test_meta_connection`: un único `POST` a
  `https://api.meta.ai/v1/responses` con la petición exacta
  `Responde solo: Ruth IDE listo`, `max_output_tokens: 64` y timeout de 30 s.
  Sin llamadas al arrancar, sin reintentos y con una sola prueba simultánea.
- Respuesta devuelta como texto + modelo + uso de tokens (cuando la API lo da).
  Sin costos inventados y sin volcar respuestas crudas.
- Errores distinguidos: clave ausente, autenticación (401), facturación (402),
  sin permiso (403), rate limit (429, con `Retry-After`), modelo inexistente
  (404), servidor (5xx), red y timeout.
- Comando `meta_status`: lectura local de presencia de clave y modelo, sin red.
- En navegador se informa que la prueba nativa requiere Tauri; no hay proxy ni
  simulación.
- Tests Rust del protocolo y los errores con fixtures, sin consumo real
  (`src-tauri/crates/meta`).

## Terminal integrada

Panel inferior con hasta tres sesiones de shell real (PTY vía
`portable-pty`, presentación con xterm.js): sirve para shells, agentes de
programación como `$HOME/.local/bin/muse`, servidores locales y Git. Icono
al pie del rail; ocultar conserva sesiones y scrollback. Cada sesión tiene
nombre, estado e iconos propios de limpiar (vista) y cerrar; la barra
global reúne nueva terminal, alternar pestañas/en paralelo, carpeta y
ocultar. En paralelo, separadores redimensionables con ancho mínimo y
foco marcado; alternar disposición no pierde salida ni reinicia nada.

- **Permisos**: la terminal corre con tus permisos de usuario. No es un
  sandbox ni está confinada a la carpeta inicial: documentado, no
  prometido lo contrario.
- **Entorno**: el hijo hereda tu entorno **menos** la familia `META_*`
  (incluida `META_API_KEY`): nada de inferencia que Ruth conozca cruza
  a la terminal, y ningún secreto se escribe en registros, SQLite o
  historial de Ruth. Si tu shell carga credenciales desde tu propia
  configuración (`~/.bashrc` y compañía), Ruth no puede impedirlo.
- **Ciclo de vida**: limpiar solo borra la vista; cerrar pide
  confirmación si hay proceso en marcha y lo termina; cerrar Ruth con
  terminales abiertas pide confirmación y no restaura procesos al
  reabrir. Nada de terminal se persiste.
- **Límites**: tres sesiones; salida por eventos en fragmentos de 8 KiB
  con scrollback de 2000 líneas por vista; pegados por trozos de 60 KiB
  (tope 256 KiB por escritura); Ctrl+C interrumpe (PTY), Ctrl+Mayús+C/V
  copian/pegan, Ctrl+S dentro de la terminal es XOFF del PTY (no
  guarda el editor). Windows compila el mismo código pero no está
  verificado aquí. En navegador, el panel indica que requiere
  escritorio y no simula nada.

## Qué está pendiente (fuera de este hito)

Ejecución automática de cambios, imágenes renderizadas o PDF en la
exportación, análisis de impacto con IA, generación de código,
editor de código, importación de repositorios, agentes múltiples,
sincronización remota, publicación y despliegue. Los borradores sin guardar
(incluidos la descripción del módulo y las ediciones de propuestas,
diseños y mockups) siguen sin protección ante cierre de ventana o fallo
del proceso: solo lo confirmado en Rust llega a disco.

## Decisiones principales

- **Monolito modular por funcionalidades**, sin microservicios ni ORM.
- **Dominio independiente**: el frontend separa tipos puros (`types.ts`) del
  adaptador Tauri (`tauri.ts`); el backend separa el crate `ruth-meta`
  (contrato + protocolo + errores) de los comandos Tauri.
- **Estado**: Zustand solo para selección compartida y paneles; borradores
  en estado local de React e instantáneas de dominio servidas por Rust.
- **Meta detrás de un contrato pequeño**: `MetaConfig::from_env()` y
  `test_connection()`, con endpoint y modelo verificados en la documentación
  oficial (`https://dev.meta.ai/docs`): Responses API y `muse-spark-1.3`.
- **La clave no cruza al frontend**: solo vive en memoria del proceso Rust
  (`SecretString` con `Debug` redactado), sin registros ni archivos.

## Verificación

```sh
npm test                                    # coordinación del frontend (vitest)
npx tsc --noEmit                            # tipos del frontend
npm run build                               # compilación web de producción
cargo test --workspace                      # Rust completo (sin red real)
cargo clippy --workspace --all-targets      # lints
cargo fmt --check                           # formato
cargo check                                 # app Tauri completa (requiere deps. de sistema)
npx tauri info                              # diagnóstico del entorno Tauri
```

Las llamadas reales a Meta solo se disparan con los botones **Probar
conexión**, **Proponer requisitos** y **Generar flujo/ER** dentro de la app
de escritorio. Los tests automatizados no consumen la API.

Caso manual (asistente, con `META_API_KEY` configurada): abrir la
pestaña Asistente → comprobar contexto y aviso de borradores → elegir
Proponer requisitos → Enviar una descripción → revisar el campo
alimentado y generar → aceptar una propuesta → elegir Generar flujo →
marcar fuentes y generar → aceptar el borrador → abrir Impacto con un
origen → volver al asistente → Proponer actualización de un diseño
afectado → comparar e incorporar → desplegar el historial y comprobar
modelo, tokens y pendientes.

Caso manual (etapa B, con `META_API_KEY` configurada): vista
**Mockups** → crear pantalla «Nueva reserva» → añadir campos cliente,
producto y cantidad más botón Confirmar → Ctrl+S → **Generar diseño**
desde el mockup (añadir requisitos a mano si hace falta) → revisar
propuesta de flujo y ER → editar un campo → Ctrl+S → abrir **Impacto**
→ incorporar la actualización sin aprobación obligatoria → cerrar y
reabrir → comprobar mockup, historial y fuentes → exportar entrega de
trabajo y cotejar que el ZIP trae el JSON del mockup más su resumen.

Caso manual (renombrado, sin red): menú "…" de un requisito sin título →
comprobar que se muestra su primera línea → Renombrar → poner título →
comprobar árbol, encabezado e inspectores → crear baseline → renombrar de
nuevo → abrir el detalle histórico y comprobar título fijado frente a
vigente → exportar el ZIP y cotejar encabezados y `manifest.json` →
renombrar proyecto y módulo desde el árbol → cerrar y reabrir →
comprobar que todo persiste.

Caso manual (archivo, sin red): crear requisito borrador → menú "…" →
Eliminar definitivamente (resumen vacío, confirmación con nombre) →
comprobar que desaparece → crear otro, archivado individual → comprobar
que se oculta → «Mostrar archivados» → restaurarlo → archivar el módulo
→ comprobar listas vacías honestas y edición bloqueada → restaurar.

Caso manual (hito 10, sin red, desde diseños ya aprobados): abrir un
diseño → pestaña **Lienzo/Editor** → arrastrar, zoom con rueda y botones
(ajustar, 100 %) → mover elementos y comprobar que no aparece "sin
guardar" semántico → añadir un paso/atributo con el inspector,
deshacer/rehacer → **Guardar y crear versión** → comprobar procedencia
humana sin aprobación heredada → reordenar solo posiciones → guardar
disposición → cerrar y reabrir → comprobar contenido y posiciones.

Caso manual (hito 9, sin red): crear requisitos, flujo y ER de ventas y
aprobarlos → **Exportar** → **Preparar entrega** → elegir artefactos →
**Crear baseline** A → cambiar la regla de reservas y aprobarla → volver a
preparar y comprobar el bloqueo por fuentes desactualizadas → actualizar,
revisar y aprobar flujo y ER → crear baseline B → **Guardar ZIP** de B con
el diálogo nativo → exportar también A y comprobar que conserva las
versiones anteriores → abrir los ZIP y cotejar `manifest.json` con
`sha256sum`.

Caso manual (hito 8, con `META_API_KEY` configurada): aprobar requisitos,
flujo y ER de ventas → cambiar y aprobar la regla de reservas → abrir
**Impacto** → **Proponer actualización** del flujo → comparar diagramas y
diff → **Aceptar como borrador** → revisar y aprobar → comprobar que ER
sigue pendiente → actualizar ER igual → cerrar y reabrir → comprobar
historial, fuentes y propuestas.

Caso manual (hito 7, sin red): crear y aprobar requisitos de ventas →
generar y aprobar flujo y ER → cambiar la regla a "Reservar unidades antes
de confirmar; cancelar libera la reserva" → abrir **Impacto** → comprobar
diseños pendientes con fuentes antiguas → revisar un diseño y crear otra
versión → comprobar que su pendiente desaparece mientras el otro continúa.

Caso manual (hito 6, con `META_API_KEY` configurada): aprobar requisitos
de ventas → vista **Diseño** → seleccionar fuentes → **Generar flujo** →
revisar diagrama y JSON, editar si hace falta → **Aceptar como borrador**
→ aprobar desde Revisión → repetir con **Generar ER** → cerrar y reabrir
→ comprobar diagramas, fuentes e historial.

## Transparencia

Antes del evento existió una exploración previa (Atelier / Ruth IDE) cuyo
código **no se ha leído ni reutilizado** en este repositorio: todo el código
aquí se creó desde cero durante el hackathon. Ver
[docs/alcance-hackathon.md](docs/alcance-hackathon.md).
