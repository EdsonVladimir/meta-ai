//! Verifiable Sales example (without calling Meta).
//!
//! Requirement → derived flow and data model → approval → baseline →
//! rule change → impact → review → second baseline.

use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, BaselineId, Content, CoreError, Date, HumanId, ModuleId,
    ProjectId, VersionId,
};

fn project() -> ProjectId {
    ProjectId::new("proy-ventas").expect("id")
}

fn module() -> ModuleId {
    ModuleId::new("mod-ventas").expect("id")
}

fn human() -> Author {
    Author::Human(HumanId::new("ana").expect("id"))
}

fn date(day: &str) -> Date {
    Date::new(day).expect("date")
}

fn setup() -> Result<
    (
        Store,
        ProjectId,
        ModuleId,
        ArtifactId,
        ArtifactId,
        ArtifactId,
    ),
    CoreError,
> {
    let mut store = Store::new();
    let project = project();
    let module = module();
    let req = ArtifactId::new("req-venta")?;
    let flow = ArtifactId::new("flujo-venta")?;
    let data = ArtifactId::new("datos-venta")?;
    store.create_project(project.clone())?;
    store.create_module(&project, module.clone())?;
    store.create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)?;
    store.create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)?;
    store.create_artifact(&project, &module, data.clone(), ArtifactType::DataModel)?;
    Ok((store, project, module, req, flow, data))
}

#[test]
fn sales_end_to_end() -> Result<(), CoreError> {
    let (mut store, project, _, req, flow, data) = setup()?;
    let author = human();

    // 1. Requirement v1 + derivatives depending on it.
    let req_v1 = VersionId::new("req-venta-v1")?;
    let flow_v1 = VersionId::new("flujo-venta-v1")?;
    let data_v1 = VersionId::new("datos-venta-v1")?;
    store.create_version(
        &project,
        &req,
        None,
        req_v1.clone(),
        Content::new("Confirmar una venta descuenta stock.")?,
        &author,
        &[],
    )?;
    store.create_version(
        &project,
        &flow,
        None,
        flow_v1.clone(),
        Content::new("Flujo: confirmar venta.")?,
        &author,
        std::slice::from_ref(&req_v1),
    )?;
    store.create_version(
        &project,
        &data,
        None,
        data_v1.clone(),
        Content::new("Modelo: venta descuenta stock.")?,
        &author,
        std::slice::from_ref(&req_v1),
    )?;

    // 2. Approve the three versions and create the baseline.
    for (artifact, version) in [(&req, &req_v1), (&flow, &flow_v1), (&data, &data_v1)] {
        store.approve(&project, artifact, version, &author, date("2026-10-20"))?;
    }
    let base_1 = BaselineId::new("base-1")?;
    store.create_baseline(
        &project,
        base_1.clone(),
        &[
            (req.clone(), req_v1.clone()),
            (flow.clone(), flow_v1.clone()),
            (data.clone(), data_v1.clone()),
        ],
        date("2026-10-21"),
    )?;
    let base_1_snapshot = store.baseline(&base_1).expect("base-1").clone();

    // 3. Requirement v2: allow reservations before confirming.
    let req_v2 = VersionId::new("req-venta-v2")?;
    store.create_version(
        &project,
        &req,
        Some(&req_v1),
        req_v2.clone(),
        Content::new("Permitir reservas antes de confirmar; confirmar descuenta stock.")?,
        &author,
        &[],
    )?;

    // 4. Flow and data require review, with explanatory paths.
    let review = store.requires_review(&project)?;
    assert_eq!(review, vec![data.clone(), flow.clone()]);
    let report = store.impact(&project, std::slice::from_ref(&req))?;
    assert_eq!(report.changed, vec![req.clone()]);
    let affected: Vec<&str> = report
        .affected
        .iter()
        .map(|a| a.artifact.as_str())
        .collect();
    assert_eq!(affected, vec!["datos-venta", "flujo-venta"]);
    for item in &report.affected {
        assert_eq!(item.paths.len(), 1);
        let path: Vec<&str> = item.paths[0].iter().map(|a| a.as_str()).collect();
        assert_eq!(path[0], "req-venta");
        assert_eq!(path[path.len() - 1], item.artifact.as_str());
    }

    // 5. The baseline and earlier approvals are preserved.
    assert_eq!(store.baseline(&base_1), Some(&base_1_snapshot));
    assert_eq!(store.approvals_of(&req_v1).len(), 1);
    assert_eq!(store.approvals_of(&flow_v1).len(), 1);
    assert_eq!(
        store.version(&req_v1).expect("v1").content().as_str(),
        "Confirmar una venta descuenta stock."
    );

    // 6. Re-approving the stale derivative is not enough, nor does it fit
    // in a new baseline.
    store.approve(&project, &req, &req_v2, &author, date("2026-10-22"))?;
    let stale = store.approve(&project, &flow, &flow_v1, &author, date("2026-10-22"));
    assert!(
        matches!(stale, Err(CoreError::VersionNotValid { .. })),
        "era {stale:?}"
    );
    let blocked = store.create_baseline(
        &project,
        BaselineId::new("base-2-intento")?,
        &[
            (req.clone(), req_v2.clone()),
            (flow.clone(), flow_v1.clone()),
            (data.clone(), data_v1.clone()),
        ],
        date("2026-10-22"),
    );
    assert!(
        matches!(blocked, Err(CoreError::BaselineMissingSource { .. })),
        "era {blocked:?}"
    );
    assert!(store
        .baseline(&BaselineId::new("base-2-intento")?)
        .is_none());

    // 7. Reviewed versions with current sources, approval and baseline 2.
    let flow_v2 = VersionId::new("flujo-venta-v2")?;
    let data_v2 = VersionId::new("datos-venta-v2")?;
    store.create_version(
        &project,
        &flow,
        Some(&flow_v1),
        flow_v2.clone(),
        Content::new("Flujo: reservar y confirmar venta.")?,
        &author,
        std::slice::from_ref(&req_v2),
    )?;
    store.create_version(
        &project,
        &data,
        Some(&data_v1),
        data_v2.clone(),
        Content::new("Modelo: reserva y descuento de stock.")?,
        &author,
        std::slice::from_ref(&req_v2),
    )?;
    assert!(store.validity(&flow_v2)?.valid);
    store.approve(&project, &flow, &flow_v2, &author, date("2026-10-23"))?;
    store.approve(&project, &data, &data_v2, &author, date("2026-10-23"))?;
    let base_2 = BaselineId::new("base-2")?;
    store.create_baseline(
        &project,
        base_2.clone(),
        &[
            (req.clone(), req_v2.clone()),
            (flow.clone(), flow_v2.clone()),
            (data.clone(), data_v2.clone()),
        ],
        date("2026-10-24"),
    )?;

    // 8. The historic baseline stays intact and reproducible.
    assert_eq!(store.baseline(&base_1), Some(&base_1_snapshot));
    let entries_1: Vec<(&str, &str)> = store
        .baseline(&base_1)
        .expect("base-1")
        .entries()
        .iter()
        .map(|(a, v)| (a.as_str(), v.as_str()))
        .collect();
    assert_eq!(
        entries_1,
        vec![
            ("datos-venta", "datos-venta-v1"),
            ("flujo-venta", "flujo-venta-v1"),
            ("req-venta", "req-venta-v1"),
        ]
    );
    assert!(store.requires_review(&project)?.is_empty());
    Ok(())
}
