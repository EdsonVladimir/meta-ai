# Ruth IDE — Hito 6: diseño vinculado a requisitos con Meta

Espacio de trabajo visual que transforma requisitos en artefactos de diseño
vinculados. Cuando cambia una regla, identifica dependencias afectadas y propone
ajustes que una persona revisa y aprueba.

Este hito añade diseño vinculado: seleccionar requisitos aprobados, generar
con Meta una propuesta de flujo o ER, visualizarla con Mermaid local,
revisarla y aceptarla como borrador con dependencias exactas, más una
distribución visual inspirada en el mockup. La aprobación sigue siendo
humana. Ver [docs/alcance-hackathon.md](docs/alcance-hackathon.md) para el
alcance de competencia y [docs/arquitectura.md](docs/arquitectura.md) para
el diseño.

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

## Qué está implementado (hito 6)

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

## Qué está pendiente (fuera de este hito)

Mapa interactivo de impacto, propuestas automáticas de actualización,
análisis de impacto con IA, terminales, generación de código, editor de
código, importación de repositorios, agentes múltiples, sincronización
remota, publicación y despliegue. Los borradores sin guardar (incluidos la
descripción del módulo y las ediciones de propuestas y diseños) siguen sin
protección ante cierre de ventana o fallo del proceso: solo lo confirmado
en Rust llega a disco.

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
