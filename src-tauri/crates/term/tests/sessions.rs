//! Sesiones PTY reales: ciclo de vida, E/S, límites, entorno depurado.
//! Sin red, sin agentes, sin nada que tocar fuera de `/tmp`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ruth_term::{EventSink, SessionInfo, ShellSpec, TermErrorKind, TerminalManager, MAX_SESSIONS};

#[derive(Clone, Debug)]
enum Event {
    Output { id: String, data: String },
    Exited { id: String, code: Option<i32> },
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<Event>>,
}

impl Recorder {
    fn outputs_for(&self, id: &str) -> String {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                Event::Output { id: other, data } if other == id => Some(data.clone()),
                _ => None,
            })
            .collect()
    }

    fn exit_for(&self, id: &str) -> Option<Option<i32>> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .find_map(|event| match event {
                Event::Exited { id: other, code } if other == id => Some(*code),
                _ => None,
            })
    }
}

impl EventSink for Recorder {
    fn output(&self, id: &str, data: &str) {
        self.events.lock().unwrap().push(Event::Output {
            id: id.to_string(),
            data: data.to_string(),
        });
    }

    fn exited(&self, id: &str, code: Option<i32>) {
        self.events.lock().unwrap().push(Event::Exited {
            id: id.to_string(),
            code,
        });
    }
}

fn manager() -> (TerminalManager, Arc<Recorder>) {
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn EventSink> = Arc::clone(&recorder) as Arc<dyn EventSink>;
    (TerminalManager::new(sink), recorder)
}

fn has_sh() -> bool {
    std::path::Path::new("/bin/sh").exists()
}

fn wait_for(cond: impl Fn() -> bool, what: &str) {
    let start = Instant::now();
    while !cond() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "tiempo agotado esperando: {what}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn crear_lista_y_describir() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    let first = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear sesión");
    assert_eq!(first.id, "term-1");
    assert!(first.running);
    assert_eq!(first.exit_code, None);
    assert_eq!(first.shell, "/bin/sh");
    assert!(!first.cwd.is_empty());
    let second = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear segunda sesión");
    assert_eq!(second.id, "term-2");
    let ids: Vec<String> = manager
        .list()
        .iter()
        .map(|info: &SessionInfo| info.id.clone())
        .collect();
    assert_eq!(ids, vec!["term-1".to_string(), "term-2".to_string()]);
    assert_eq!(manager.describe("term-1").expect("describir").id, "term-1");
    assert_eq!(manager.running_count(), 2);
    manager.shutdown();
    assert!(manager.list().is_empty());
}

#[test]
fn limite_de_sesiones_y_cierre_con_errores() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    for _ in 0..MAX_SESSIONS {
        manager
            .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
            .expect("crear dentro del límite");
    }
    let err = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect_err("cuarta sesión");
    assert_eq!(err.kind, TermErrorKind::TooManySessions);
    assert_eq!(err.kind_str(), "too_many_sessions");
    manager.close("term-1").expect("cerrar una");
    manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear tras cerrar");
    let missing = manager.close("term-99").expect_err("cerrar inexistente");
    assert_eq!(missing.kind, TermErrorKind::UnknownSession);
    let missing = manager
        .write("term-99", "x")
        .expect_err("escribir inexistente");
    assert_eq!(missing.kind, TermErrorKind::UnknownSession);
    manager.shutdown();
}

#[test]
fn eco_de_salida_y_escritura() {
    if !has_sh() {
        return;
    }
    let (mut manager, recorder) = manager();
    let info = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &["-c", "echo marca-ruth-42; exec sleep 30"]),
            &[],
            None,
            80,
            24,
        )
        .expect("crear eco");
    wait_for(
        || recorder.outputs_for(&info.id).contains("marca-ruth-42"),
        "eco del hijo",
    );
    // Escritura a un `cat`: lo tecleado vuelve por el PTY.
    let cat = manager
        .create_with(&ShellSpec::new("/bin/cat", &[]), &[], None, 80, 24)
        .expect("crear cat");
    manager.write(&cat.id, "ping-ruth\n").expect("escribir");
    wait_for(
        || recorder.outputs_for(&info.id).contains("marca-ruth-42"),
        "eco previo intacto",
    );
    wait_for(
        || recorder.outputs_for(&cat.id).contains("ping-ruth"),
        "eco de cat",
    );
    manager.shutdown();
}

#[test]
fn fin_de_proceso_con_codigo_y_escritura_posterior() {
    if !has_sh() {
        return;
    }
    let (mut manager, recorder) = manager();
    let info = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &["-c", "exit 7"]),
            &[],
            None,
            80,
            24,
        )
        .expect("crear salida 7");
    wait_for(|| recorder.exit_for(&info.id).is_some(), "aviso de fin");
    assert_eq!(recorder.exit_for(&info.id), Some(Some(7)));
    let described = manager.describe(&info.id).expect("describir fin");
    assert!(!described.running);
    assert_eq!(described.exit_code, Some(7));
    assert_eq!(manager.running_count(), 0);
    let err = manager.write(&info.id, "x").expect_err("escribir tras fin");
    assert_eq!(err.kind, TermErrorKind::SessionExited);
    let err = manager
        .resize(&info.id, 80, 24)
        .expect_err("redimensionar tras fin");
    assert_eq!(err.kind, TermErrorKind::SessionExited);
    manager.close(&info.id).expect("cerrar sesión terminada");
}

#[test]
fn redimension_y_tamanos_invalidos() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    let info = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear");
    let resized = manager.resize(&info.id, 100, 30).expect("redimensionar");
    assert_eq!((resized.cols, resized.rows), (100, 30));
    for (cols, rows) in [(0, 24), (1, 24), (80, 0), (600, 24), (80, 300)] {
        let err = manager
            .resize(&info.id, cols, rows)
            .expect_err("tamaño inválido");
        assert_eq!(err.kind, TermErrorKind::BadSize, "para {cols}×{rows}");
    }
    let err = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 0, 24)
        .expect_err("crear sin columnas");
    assert_eq!(err.kind, TermErrorKind::BadSize);
    manager.shutdown();
}

#[test]
fn carpeta_invalida_y_carga_enorme() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    let err = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &[]),
            &[],
            Some("/no/existe/ruth-xyz".into()),
            80,
            24,
        )
        .expect_err("carpeta inexistente");
    assert_eq!(err.kind, TermErrorKind::BadDirectory);
    let err = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &[]),
            &[],
            Some("/bin/sh".into()),
            80,
            24,
        )
        .expect_err("carpeta que es archivo");
    assert_eq!(err.kind, TermErrorKind::BadDirectory);
    let info = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear");
    let huge = "x".repeat(300 * 1024);
    let err = manager.write(&info.id, &huge).expect_err("carga enorme");
    assert_eq!(err.kind, TermErrorKind::PayloadTooLarge);
    manager.shutdown();
}

#[test]
fn ctrl_c_llega_al_pty_y_el_shell_reporta_su_tamano() {
    if !has_sh() {
        return;
    }
    let (mut manager, recorder) = manager();
    // `cat` muere con SIGINT: escribir \x03 equivale a Ctrl+C.
    let cat = manager
        .create_with(&ShellSpec::new("/bin/cat", &[]), &[], None, 80, 24)
        .expect("crear cat");
    manager.write(&cat.id, "\x03").expect("escribir Ctrl+C");
    wait_for(|| recorder.exit_for(&cat.id).is_some(), "fin por SIGINT");
    manager.close(&cat.id).expect("cerrar");
    // El PTY informa su tamaño real al shell (`stty size` → filas cols).
    let shell = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("crear shell");
    let resized = manager.resize(&shell.id, 100, 30).expect("redimensionar");
    assert_eq!((resized.cols, resized.rows), (100, 30));
    manager
        .write(&shell.id, "stty size; exit\n")
        .expect("pedir tamaño");
    wait_for(
        || recorder.outputs_for(&shell.id).contains("30 100"),
        "tamaño 30x100 en el shell",
    );
    wait_for(|| recorder.exit_for(&shell.id).is_some(), "fin del shell");
    manager.close(&shell.id).expect("cerrar");
}

#[test]
fn el_hijo_no_recibe_credenciales_meta() {
    if !has_sh() || !std::path::Path::new("/usr/bin/env").exists() {
        return;
    }
    let (mut manager, recorder) = manager();
    let env = vec![
        ("META_API_KEY".to_string(), "ultra-secreta".to_string()),
        ("META_OTRA".to_string(), "tambien-fuera".to_string()),
        ("RUTH_CONTROL".to_string(), "visible".to_string()),
    ];
    // `scrub_env` es lo que `create` aplica; aquí se comprueba el camino
    // completo hasta el proceso hijo a través de `env`.
    let mut scrubbed = env.clone();
    ruth_term::scrub_env(&mut scrubbed);
    let info = manager
        .create_with(
            &ShellSpec::new("/usr/bin/env", &[]),
            &scrubbed,
            None,
            80,
            24,
        )
        .expect("crear env");
    wait_for(|| recorder.exit_for(&info.id).is_some(), "fin de env");
    let output = recorder.outputs_for(&info.id);
    assert!(output.contains("RUTH_CONTROL=visible"), "el resto pasa");
    assert!(!output.contains("META_API_KEY"), "la clave no cruza");
    assert!(!output.contains("ultra-secreta"), "el valor no cruza");
    assert!(!output.contains("META_OTRA"), "la familia no cruza");
    manager.shutdown();
}
