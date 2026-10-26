# Ruth IDE — Hito 1: base de escritorio y prueba mínima con Meta

Espacio de trabajo visual que transforma requisitos en artefactos de diseño
vinculados. Cuando cambia una regla, identifica dependencias afectadas y propone
ajustes que una persona revisa y aprueba.

Este hito implementa **solo** la base de escritorio (Tauri 2 + React) y una
prueba mínima de conexión real con Meta Model API. Ver
[docs/alcance-hackathon.md](docs/alcance-hackathon.md) para el alcance de
competencia y el recorrido objetivo completo.

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

## Qué está implementado (hito 1)

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

Explorador, terminales, editor de código, SQLite, diagramas, generación de
requisitos, agentes múltiples, despliegue, iconos de empaquetado y cualquier
flujo posterior a la prueba de conexión.

## Decisiones principales

- **Monolito modular por funcionalidades**, sin microservicios ni ORM.
- **Dominio independiente**: el frontend separa tipos puros (`types.ts`) del
  adaptador Tauri (`tauri.ts`); el backend separa el crate `ruth-meta`
  (contrato + protocolo + errores) de los comandos Tauri.
- **Estado local de React** (`useState`/`useRef`); sin store global.
- **Meta detrás de un contrato pequeño**: `MetaConfig::from_env()` y
  `test_connection()`, con endpoint y modelo verificados en la documentación
  oficial (`https://dev.meta.ai/docs`): Responses API y `muse-spark-1.3`.
- **La clave no cruza al frontend**: solo vive en memoria del proceso Rust
  (`SecretString` con `Debug` redactado), sin registros ni archivos.

## Verificación

```sh
npx tsc --noEmit          # tipos del frontend
npm run build             # compilación web de producción
cargo test -p ruth-meta   # protocolo y errores con fixtures (sin red real)
cargo check               # app Tauri completa (requiere deps. de sistema)
npx tauri info            # diagnóstico del entorno Tauri
```

Las llamadas reales a Meta solo se disparan con el botón **Probar conexión**
dentro de la app de escritorio. Los tests automatizados no consumen la API.

## Transparencia

Antes del evento existió una exploración previa (Atelier / Ruth IDE) cuyo
código **no se ha leído ni reutilizado** en este repositorio: todo el código
aquí se creó desde cero durante el hackathon. Ver
[docs/alcance-hackathon.md](docs/alcance-hackathon.md).
