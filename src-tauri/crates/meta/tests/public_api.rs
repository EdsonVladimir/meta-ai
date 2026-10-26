//! Superficie pública de `ruth-meta` que consume `src-tauri/src/lib.rs`.
//!
//! Regresión de E0603: `MetaError` debe vivir en la raíz del crate. Si el
//! re-export se pierde, este test ni siquiera compila.

#[test]
fn meta_error_is_public_at_crate_root() {
    let err = ruth_meta::MetaError::busy();
    assert_eq!(err.kind, ruth_meta::MetaErrorKind::Busy);
    assert!(!err.retryable);
    assert!(err.message.contains("prueba de conexión"));
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
