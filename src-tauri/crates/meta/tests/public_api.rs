//! Public surface of `ruth-meta` consumed by `src-tauri/src/lib.rs`.
//!
//! E0603 regression: `MetaError` must live at the crate root. If the
//! re-export is lost, this test does not even compile.

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
