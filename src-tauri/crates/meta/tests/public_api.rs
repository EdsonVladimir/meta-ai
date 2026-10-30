//! Public surface of `ruth-meta` consumed by `src-tauri/src/lib.rs`.
//!
//! E0603 regression: `MetaError` must live at the crate root. If the
//! re-export is lost, this test does not even compile.

use ruth_meta::code::{
    append_instruction, append_previous_proposal, PreviousCodeFile, MAX_CODE_INPUT_CHARS,
    MAX_INSTRUCTION_CHARS,
};

#[test]
fn meta_error_is_public_at_crate_root() {
    let err = ruth_meta::MetaError::busy();
    assert_eq!(err.kind, ruth_meta::MetaErrorKind::Busy);
    assert!(!err.retryable);
    assert!(err.message.contains("connection test"));
}

#[test]
fn incomplete_and_refusal_serialize_snake_case_for_frontend() {
    let cases = [
        (ruth_meta::MetaErrorKind::Incomplete, "incomplete"),
        (ruth_meta::MetaErrorKind::Refusal, "refusal"),
    ];
    for (kind, wire) in cases {
        let err = ruth_meta::MetaError::new(kind, "x", false);
        let json = serde_json::to_value(&err).expect("serializable");
        assert_eq!(json["kind"], wire);
    }
}

#[test]
fn instruction_is_appended_as_a_person_request() {
    let out = append_instruction("BASE".to_string(), Some("add email validation"));
    assert!(out.starts_with("BASE"));
    assert!(out.contains("add email validation"));
}

#[test]
fn blank_instruction_changes_nothing() {
    assert_eq!(append_instruction("BASE".to_string(), Some("   ")), "BASE");
    assert_eq!(append_instruction("BASE".to_string(), None), "BASE");
}

#[test]
fn previous_proposal_goes_before_the_request() {
    let files = [PreviousCodeFile {
        rel: "src/a.ts".to_string(),
        operation: "create".to_string(),
        content: "export class A {}".to_string(),
    }];
    let with_files = append_previous_proposal("BASE".to_string(), &files);
    let out = append_instruction(with_files, Some("add email"));
    let proposal = out.find("export class A {}").expect("previous code");
    let request = out.find("add email").expect("request");
    assert!(out.contains("src/a.ts"));
    assert!(proposal < request);
}

#[test]
fn no_previous_proposal_changes_nothing() {
    assert_eq!(append_previous_proposal("BASE".to_string(), &[]), "BASE");
}

#[test]
fn previous_proposal_respects_the_input_cap() {
    let files: Vec<PreviousCodeFile> = (0..5)
        .map(|i| PreviousCodeFile {
            rel: format!("src/f{i}.ts"),
            operation: "modify".to_string(),
            content: "x".repeat(60_000),
        })
        .collect();
    let out = append_previous_proposal("BASE".to_string(), &files);
    assert!(out.chars().count() <= MAX_CODE_INPUT_CHARS);
}

#[test]
fn instruction_is_capped() {
    let long = "x".repeat(MAX_INSTRUCTION_CHARS + 50);
    let out = append_instruction(String::new(), Some(&long));
    assert_eq!(out.matches('x').count(), MAX_INSTRUCTION_CHARS);
}
