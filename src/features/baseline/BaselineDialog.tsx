// Diálogo de entregas: preparar un conjunto coherente, crear la baseline
// con una acción humana explícita y exportarla a un ZIP reproducible.
// Crear la baseline y guardar el ZIP son pasos separados: si se cancela el
// diálogo de guardado, la baseline sigue existiendo sin archivo.
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriEnvironment } from "../../lib/env";
import { listArtifacts } from "../design/client";
import { listModules } from "../requirements/client";
import type { ArtifactDto, CoreApiError, ModuleDto } from "../requirements/types";
import {
  createBaseline,
  exportPreview,
  exportSave,
  getBaseline,
  listBaselines,
  pickZipDestination,
  prepareBaseline,
} from "./client";
import {
  blockerTitle,
  defaultZipName,
  formatBytes,
  isStaleBaselineResponse,
  kindLabel,
  prepareKey,
} from "./coordination";
import { DeliveriesPane, DeliveryPreparePane } from "./DeliveryDialog";
import type {
  BaselineDto,
  BaselinePreviewDto,
  BaselineSummaryDto,
  ExportPreviewDto,
  ExportSaveDto,
} from "./types";

interface Props {
  projectId: string;
  moduleId: string | null;
  onClose: () => void;
}

type Tab = "prepare" | "baselines";
type Mode = "work" | "approved";

export function BaselineDialog({ projectId, moduleId, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("work");
  const [tab, setTab] = useState<Tab>("prepare");
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isTauriEnvironment()) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Entregas"
          onClick={(e) => e.stopPropagation()}
        >
          <h3>Entregas</h3>
          <p className="hint">Preparar entregas y exportar al disco requiere escritorio.</p>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide baseline-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Entregas y exportación"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="baseline-head">
          <h3>Entregas</h3>
          <div className="baseline-tabs" role="tablist" aria-label="Tipo de entrega">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "work"}
              className={mode === "work" ? "active" : ""}
              onClick={() => setMode("work")}
              title="Borrador desde versiones guardadas, sin exigir revisión"
            >
              De trabajo
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "approved"}
              className={mode === "approved" ? "active" : ""}
              onClick={() => setMode("approved")}
              title="Baseline con versiones aprobadas, actuales y coherentes"
            >
              Aprobada
            </button>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="baseline-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prepare"}
            className={tab === "prepare" ? "active" : ""}
            onClick={() => setTab("prepare")}
          >
            Preparar entrega
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "baselines"}
            className={tab === "baselines" ? "active" : ""}
            onClick={() => setTab("baselines")}
          >
            {mode === "work" ? "Entregas" : "Baselines"}
          </button>
        </div>
        {mode === "work" ? (
          tab === "prepare" ? (
            <DeliveryPreparePane
              projectId={projectId}
              moduleId={moduleId}
              onCreated={(id) => {
                setCreatedId(id);
                setTab("baselines");
              }}
            />
          ) : (
            <DeliveriesPane projectId={projectId} focusId={createdId} onConsumedFocus={() => setCreatedId(null)} />
          )
        ) : tab === "prepare" ? (
          <PreparePane
            projectId={projectId}
            moduleId={moduleId}
            onCreated={(id) => {
              setCreatedId(id);
              setTab("baselines");
            }}
          />
        ) : (
          <BaselinesPane projectId={projectId} focusId={createdId} onConsumedFocus={() => setCreatedId(null)} />
        )}
      </div>
    </div>
  );
}

function errorText(err: unknown): string {
  const e = err as Partial<CoreApiError>;
  return typeof e.message === "string" && e.message ? e.message : "Error inesperado.";
}

function errorKind(err: unknown): string {
  const e = err as Partial<CoreApiError>;
  return typeof e.kind === "string" ? e.kind : "";
}

function PreparePane({
  projectId,
  moduleId,
  onCreated,
}: {
  projectId: string;
  moduleId: string | null;
  onCreated: (id: string) => void;
}) {
  const [modules, setModules] = useState<ModuleDto[]>([]);
  const [scope, setScope] = useState(moduleId ?? "");
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<BaselinePreviewDto | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"loading" | "preparing" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const keyRef = useRef(0);

  useEffect(() => {
    const key = ++keyRef.current;
    setBusy("loading");
    setError(null);
    listModules(projectId)
      .then((mods) => {
        if (key !== keyRef.current) return;
        setModules(mods);
        if (!scope && mods.length > 0) setScope(mods[0].id);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        setError(errorText(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!scope) return;
    const key = ++keyRef.current;
    setBusy("loading");
    setError(null);
    setPreview(null);
    setSelected([]);
    listArtifacts(projectId, scope)
      .then((list) => {
        if (key !== keyRef.current) return;
        setArtifacts(list);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        setError(errorText(err));
      });
  }, [projectId, scope]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPreview(null);
    setConflict(false);
  }

  const expectedKey = prepareKey(projectId, scope, selected);

  function runPrepare() {
    const key = ++keyRef.current;
    const seen = expectedKey;
    setBusy("preparing");
    setError(null);
    setConflict(false);
    prepareBaseline({ projectId, scopeModuleId: scope, artifactIds: selected })
      .then((result) => {
        if (key !== keyRef.current || isStaleBaselineResponse(expectedKey, seen)) return;
        setPreview(result);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        setError(errorText(err));
      });
  }

  function runCreate() {
    if (!preview || !preview.canCreate || !name.trim()) return;
    const key = ++keyRef.current;
    setBusy("creating");
    setError(null);
    setConflict(false);
    createBaseline({
      projectId,
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      scopeModuleId: scope,
      entries: preview.entries.map((e) => ({
        artifactId: e.artifact.id,
        versionId: e.versionId,
      })),
    })
      .then((dto) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        onCreated(dto.id);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        if (errorKind(err) === "changed_since_preview") {
          setConflict(true);
        }
        setError(errorText(err));
      });
  }

  return (
    <div className="baseline-prepare">
      <div className="baseline-row">
        <label>
          Módulo del alcance
          <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy !== null}>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="baseline-checklist">
        <legend>Artefactos del módulo ({selected.length} elegidos)</legend>
        {busy === "loading" && <p className="hint">Cargando artefactos…</p>}
        {artifacts.map((a) => (
          <label key={a.id} className="check" title={a.title ?? a.id}>
            <input
              type="checkbox"
              checked={selected.includes(a.id)}
              onChange={() => toggle(a.id)}
              disabled={busy !== null}
            />
            {a.title ?? <code>{a.id}</code>}
            {a.title !== null && a.title !== "" && <code>{a.id}</code>}{" "}
            <span className="hint">{kindLabel(a.kind)}</span>
          </label>
        ))}
        {artifacts.length === 0 && busy === null && <p className="hint">Sin artefactos en este módulo.</p>}
      </fieldset>
      <div className="modal-actions">
        <button type="button" onClick={runPrepare} disabled={busy !== null || selected.length === 0}>
          {busy === "preparing" ? "Preparando…" : "Vista previa"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          {conflict && (
            <>
              {" "}
              <button type="button" className="ghost" onClick={runPrepare}>
                Volver a preparar
              </button>
            </>
          )}
        </p>
      )}
      {preview && (
        <div className="baseline-preview">
          <h4>
            {preview.canCreate ? "Conjunto coherente" : "Con bloqueos"} ({preview.entries.length}{" "}
            versiones)
          </h4>
          <table className="baseline-table">
            <thead>
              <tr>
                <th>Artefacto</th>
                <th>Tipo</th>
                <th>Versión</th>
                <th>Aprobación</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {preview.entries.map((e) => (
                <tr key={e.artifact.id}>
                  <td title={e.artifact.title ?? e.artifact.id}>
                    {e.artifact.title ?? <code>{e.artifact.id}</code>}
                    {e.artifact.title !== null && e.artifact.title !== "" && (
                      <code>{e.artifact.id}</code>
                    )}{" "}
                    {e.autoIncluded && <span className="pill">por cierre</span>}
                  </td>
                  <td>{kindLabel(e.artifact.kind)}</td>
                  <td>
                    <code>{e.versionId}</code>
                  </td>
                  <td>{e.approvedBy ? `${e.approvedBy} (${e.approvedAt})` : "—"}</td>
                  <td>{e.provenance.kind === "human" ? `humana (${e.provenance.by})` : `IA (${e.provenance.by})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.blockers.length > 0 && (
            <ul className="baseline-blockers">
              {preview.blockers.map((b, i) => (
                <li key={i}>
                  <strong>{blockerTitle(b.code)}:</strong> {b.message}
                </li>
              ))}
            </ul>
          )}
          {(preview.outOfScope.artifacts.length > 0 || preview.outOfScope.modules.length > 0) && (
            <p className="hint">
              Fuera del alcance:{" "}
              {[
                ...preview.outOfScope.artifacts,
                ...preview.outOfScope.modules.flatMap((m) => m.artifacts),
              ].join(", ")}
            </p>
          )}
          <div className="baseline-row">
            <label>
              Nombre de la entrega
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="p. ej. Entrega ventas 1"
                maxLength={120}
                disabled={busy !== null}
              />
            </label>
            <label>
              Descripción (opcional)
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                disabled={busy !== null}
              />
            </label>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="primary"
              onClick={runCreate}
              disabled={busy !== null || !preview.canCreate || !name.trim()}
            >
              {busy === "creating" ? "Creando…" : "Crear baseline"}
            </button>
            {!preview.canCreate && <span className="hint">Resuelve los bloqueos para crearla.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function BaselinesPane({
  projectId,
  focusId,
  onConsumedFocus,
}: {
  projectId: string;
  focusId: string | null;
  onConsumedFocus: () => void;
}) {
  const [list, setList] = useState<BaselineSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BaselineDto | null>(null);
  const [zip, setZip] = useState<ExportPreviewDto | null>(null);
  const [saved, setSaved] = useState<ExportSaveDto | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "detail" | "preview" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef(0);

  const refresh = useCallback(
    (focus?: string | null) => {
      const key = ++keyRef.current;
      setBusy("loading");
      setError(null);
      listBaselines(projectId)
        .then((rows) => {
          if (key !== keyRef.current) return;
          setList(rows);
          setBusy(null);
          if (focus) {
            setSelectedId(focus);
            setNotice(
              "Baseline creada. Aún no se ha guardado ningún ZIP: elige la baseline y usa «Guardar ZIP».",
            );
          }
        })
        .catch((err) => {
          if (key !== keyRef.current) return;
          setBusy(null);
          setError(errorText(err));
        });
    },
    [projectId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (focusId) {
      refresh(focusId);
      onConsumedFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setZip(null);
      setSaved(null);
      return;
    }
    const key = ++keyRef.current;
    const seen = selectedId;
    setBusy("detail");
    setError(null);
    setZip(null);
    setSaved(null);
    setPendingPath(null);
    getBaseline(projectId, selectedId)
      .then((dto) => {
        if (key !== keyRef.current || isStaleBaselineResponse(selectedId, seen)) return;
        setDetail(dto);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        setError(errorText(err));
      });
  }, [projectId, selectedId]);

  function runPreview() {
    if (!selectedId) return;
    const key = ++keyRef.current;
    const seen = selectedId;
    setBusy("preview");
    setError(null);
    setSaved(null);
    exportPreview(projectId, selectedId)
      .then((result) => {
        if (key !== keyRef.current || isStaleBaselineResponse(selectedId, seen)) return;
        setZip(result);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        setError(errorText(err));
      });
  }

  function saveTo(destPath: string, overwrite: boolean) {
    if (!selectedId) return;
    const key = ++keyRef.current;
    const seen = selectedId;
    setBusy("saving");
    setError(null);
    exportSave({ projectId, baselineId: selectedId, destPath, overwrite })
      .then((result) => {
        if (key !== keyRef.current || isStaleBaselineResponse(selectedId, seen)) return;
        setSaved(result);
        setPendingPath(null);
        setBusy(null);
      })
      .catch((err) => {
        if (key !== keyRef.current) return;
        setBusy(null);
        if (errorKind(err) === "export_exists") {
          setPendingPath(destPath);
        }
        setError(errorText(err));
      });
  }

  async function runSave() {
    if (!selectedId || !detail) return;
    setError(null);
    setPendingPath(null);
    let dest: string | null;
    try {
      dest = await pickZipDestination(defaultZipName(detail.name, detail.id));
    } catch (err) {
      setError(errorText(err));
      return;
    }
    if (dest === null) return; // Cancelar no escribe ni informa éxito.
    saveTo(dest, false);
  }

  return (
    <div className="baseline-list">
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="baseline-columns">
        <ul className="baseline-items">
          {busy === "loading" && <li className="hint">Cargando baselines…</li>}
          {list.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={b.id === selectedId ? "active" : ""}
                onClick={() => {
                  setSelectedId(b.id);
                  setNotice(null);
                }}
              >
                <strong>{b.name}</strong>
                <code>{b.id}</code>
                <span className="hint">
                  {b.entryCount} versiones · {b.at}
                </span>
                {b.advanced && <span className="pill warn">el proyecto avanzó</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && busy === null && <li className="hint">Aún no hay baselines.</li>}
        </ul>
        <div className="baseline-detail">
          {!detail && busy !== "detail" && <p className="hint">Elige una baseline para verla.</p>}
          {busy === "detail" && <p className="hint">Cargando detalle…</p>}
          {detail && (
            <>
              <h4>
                {detail.name} <code>{detail.id}</code>
              </h4>
              {detail.description && <p>{detail.description}</p>}
              <p className="hint">
                {detail.at} ·{" "}
                {detail.scopeModuleId ? `módulo ${detail.scopeModuleId}` : "selección manual"} ·{" "}
                {detail.entries.length} versiones
              </p>
              <table className="baseline-table">
                <thead>
                  <tr>
                    <th>Artefacto</th>
                    <th>Tipo</th>
                    <th>Versión</th>
                    <th>Aprobación</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entries.map((e) => (
                    <tr key={e.artifact.id}>
                      <td title={e.title ?? e.artifact.id}>
                        {e.title ?? <code>{e.artifact.id}</code>}
                        {e.title !== null && e.title !== "" && <code>{e.artifact.id}</code>}{" "}
                        {e.title !== null && e.title !== "" && (
                          <span className="hint">(fijado en la entrega)</span>
                        )}
                        {e.title !== e.artifact.title &&
                          e.artifact.title !== null &&
                          e.artifact.title !== "" && (
                            <span className="hint"> · hoy: {e.artifact.title}</span>
                          )}
                      </td>
                      <td>{kindLabel(e.kind)}</td>
                      <td>
                        <code>{e.versionId}</code>
                      </td>
                      <td>
                        {e.approvals.length > 0
                          ? e.approvals.map((a) => `${a.approvedBy} (${a.at})`).join("; ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="modal-actions">
                <button type="button" onClick={runPreview} disabled={busy !== null}>
                  {busy === "preview" ? "Preparando…" : "Vista previa del ZIP"}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={runSave}
                  disabled={busy !== null || zip === null}
                  title={zip === null ? "Primero mira la vista previa del paquete" : undefined}
                >
                  {busy === "saving" ? "Guardando…" : "Guardar ZIP"}
                </button>
              </div>
              {zip && (
                <div className="baseline-preview">
                  <h4>
                    Paquete ({zip.files.length} archivos, {formatBytes(zip.totalBytes)})
                  </h4>
                  <table className="baseline-table">
                    <thead>
                      <tr>
                        <th>Archivo</th>
                        <th>Tamaño</th>
                        <th>SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zip.files.map((f) => (
                        <tr key={f.path}>
                          <td>
                            <code>{f.path}</code>
                          </td>
                          <td>{formatBytes(f.bytes)}</td>
                          <td>
                            <code title={f.sha256}>{f.sha256.slice(0, 12)}…</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="hint">
                    Los hashes verifican integridad; no son una firma digital.
                  </p>
                </div>
              )}
              {pendingPath && (
                <div className="baseline-confirm" role="alert">
                  <p>
                    Ya existe <code>{pendingPath}</code>. ¿Reemplazarlo?
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => saveTo(pendingPath, true)}
                      disabled={busy !== null}
                    >
                      Reemplazar
                    </button>
                    <button type="button" className="ghost" onClick={() => setPendingPath(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {saved && (
                <p className="notice" role="status">
                  ZIP guardado en <code>{saved.path}</code> ({formatBytes(saved.bytes)}). SHA-256:{" "}
                  <code>{saved.sha256}</code>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
