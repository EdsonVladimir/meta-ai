//! Real PTY sessions: lifecycle, I/O, limits, scrubbed environment.
//! No network, no agents, nothing to touch outside `/tmp`.

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
            "timed out waiting for: {what}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn create_list_and_describe() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    let first = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create session");
    assert_eq!(first.id, "term-1");
    assert!(first.running);
    assert_eq!(first.exit_code, None);
    assert_eq!(first.shell, "/bin/sh");
    assert!(!first.cwd.is_empty());
    let second = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create second session");
    assert_eq!(second.id, "term-2");
    let ids: Vec<String> = manager
        .list()
        .iter()
        .map(|info: &SessionInfo| info.id.clone())
        .collect();
    assert_eq!(ids, vec!["term-1".to_string(), "term-2".to_string()]);
    assert_eq!(manager.describe("term-1").expect("describe").id, "term-1");
    assert_eq!(manager.running_count(), 2);
    manager.shutdown();
    assert!(manager.list().is_empty());
}

#[test]
fn session_limit_and_closing_with_errors() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    for _ in 0..MAX_SESSIONS {
        manager
            .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
            .expect("create within the limit");
    }
    let err = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect_err("fourth session");
    assert_eq!(err.kind, TermErrorKind::TooManySessions);
    assert_eq!(err.kind_str(), "too_many_sessions");
    manager.close("term-1").expect("close one");
    manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create after closing");
    let missing = manager.close("term-99").expect_err("close missing");
    assert_eq!(missing.kind, TermErrorKind::UnknownSession);
    let missing = manager.write("term-99", "x").expect_err("write missing");
    assert_eq!(missing.kind, TermErrorKind::UnknownSession);
    manager.shutdown();
}

#[test]
fn output_echo_and_writing() {
    if !has_sh() {
        return;
    }
    let (mut manager, recorder) = manager();
    let info = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &["-c", "echo ruth-mark-42; exec sleep 30"]),
            &[],
            None,
            80,
            24,
        )
        .expect("create echo");
    wait_for(
        || recorder.outputs_for(&info.id).contains("ruth-mark-42"),
        "child echo",
    );
    // Writing to a `cat`: typed input comes back through the PTY.
    let cat = manager
        .create_with(&ShellSpec::new("/bin/cat", &[]), &[], None, 80, 24)
        .expect("create cat");
    manager.write(&cat.id, "ping-ruth\n").expect("write");
    wait_for(
        || recorder.outputs_for(&info.id).contains("ruth-mark-42"),
        "previous echo intact",
    );
    wait_for(
        || recorder.outputs_for(&cat.id).contains("ping-ruth"),
        "cat echo",
    );
    manager.shutdown();
}

#[test]
fn process_end_with_code_and_later_write() {
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
        .expect("create exit 7");
    wait_for(|| recorder.exit_for(&info.id).is_some(), "exit notice");
    assert_eq!(recorder.exit_for(&info.id), Some(Some(7)));
    let described = manager.describe(&info.id).expect("describe end");
    assert!(!described.running);
    assert_eq!(described.exit_code, Some(7));
    assert_eq!(manager.running_count(), 0);
    let err = manager.write(&info.id, "x").expect_err("write after end");
    assert_eq!(err.kind, TermErrorKind::SessionExited);
    let err = manager
        .resize(&info.id, 80, 24)
        .expect_err("resize after end");
    assert_eq!(err.kind, TermErrorKind::SessionExited);
    manager.close(&info.id).expect("close ended session");
}

#[test]
fn resize_and_invalid_sizes() {
    if !has_sh() {
        return;
    }
    let (mut manager, _) = manager();
    let info = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create");
    let resized = manager.resize(&info.id, 100, 30).expect("resize");
    assert_eq!((resized.cols, resized.rows), (100, 30));
    for (cols, rows) in [(0, 24), (1, 24), (80, 0), (600, 24), (80, 300)] {
        let err = manager
            .resize(&info.id, cols, rows)
            .expect_err("invalid size");
        assert_eq!(err.kind, TermErrorKind::BadSize, "for {cols}×{rows}");
    }
    let err = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 0, 24)
        .expect_err("create without columns");
    assert_eq!(err.kind, TermErrorKind::BadSize);
    manager.shutdown();
}

#[test]
fn invalid_folder_and_huge_payload() {
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
        .expect_err("missing folder");
    assert_eq!(err.kind, TermErrorKind::BadDirectory);
    let err = manager
        .create_with(
            &ShellSpec::new("/bin/sh", &[]),
            &[],
            Some("/bin/sh".into()),
            80,
            24,
        )
        .expect_err("folder that is a file");
    assert_eq!(err.kind, TermErrorKind::BadDirectory);
    let info = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create");
    let huge = "x".repeat(300 * 1024);
    let err = manager.write(&info.id, &huge).expect_err("huge payload");
    assert_eq!(err.kind, TermErrorKind::PayloadTooLarge);
    manager.shutdown();
}

#[test]
fn ctrl_c_reaches_the_pty_and_the_shell_reports_its_size() {
    if !has_sh() {
        return;
    }
    let (mut manager, recorder) = manager();
    // `cat` dies on SIGINT: writing \x03 equals Ctrl+C.
    let cat = manager
        .create_with(&ShellSpec::new("/bin/cat", &[]), &[], None, 80, 24)
        .expect("create cat");
    manager.write(&cat.id, "\x03").expect("write Ctrl+C");
    wait_for(|| recorder.exit_for(&cat.id).is_some(), "end by SIGINT");
    manager.close(&cat.id).expect("close");
    // The PTY reports its real size to the shell (`stty size` → rows cols).
    let shell = manager
        .create_with(&ShellSpec::new("/bin/sh", &[]), &[], None, 80, 24)
        .expect("create shell");
    let resized = manager.resize(&shell.id, 100, 30).expect("resize");
    assert_eq!((resized.cols, resized.rows), (100, 30));
    manager
        .write(&shell.id, "stty size; exit\n")
        .expect("request size");
    wait_for(
        || recorder.outputs_for(&shell.id).contains("30 100"),
        "size 30x100 in the shell",
    );
    wait_for(|| recorder.exit_for(&shell.id).is_some(), "shell end");
    manager.close(&shell.id).expect("close");
}

#[test]
fn the_child_receives_no_meta_credentials() {
    if !has_sh() || !std::path::Path::new("/usr/bin/env").exists() {
        return;
    }
    let (mut manager, recorder) = manager();
    let env = vec![
        ("META_API_KEY".to_string(), "ultra-secret".to_string()),
        ("META_OTRA".to_string(), "also-out".to_string()),
        ("RUTH_CONTROL".to_string(), "visible".to_string()),
    ];
    // `scrub_env` is what `create` applies; here the full path to the
    // child process through `env` is verified.
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
        .expect("create env");
    wait_for(|| recorder.exit_for(&info.id).is_some(), "env end");
    let output = recorder.outputs_for(&info.id);
    assert!(output.contains("RUTH_CONTROL=visible"), "the rest passes");
    assert!(!output.contains("META_API_KEY"), "the key does not cross");
    assert!(!output.contains("ultra-secret"), "the value does not cross");
    assert!(!output.contains("META_OTRA"), "the family does not cross");
    manager.shutdown();
}
