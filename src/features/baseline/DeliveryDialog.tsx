// Paneles de entrega de trabajo (borrador): preparar desde versiones guardadas
// sin exigir aprobación, crear con una acción humana explícita y exportar a ZIP.
// Las baselines históricas siguen intactas; aquí jamás se dice “coherente” ni
// “verificado”: la UI muestra pendientes, sin revisión y fuentes obsoletas.
import { useCallback, useEffect, useRef, useState } from "react";
import { listArtifacts } from "../design/client";
import { listModules } from "../requirements/client";
import type { ArtifactDto, ModuleDto } from "../requirements/types";
import {
  createDelivery,
  exportDeliveryPreview,
  exportDeliverySave,
  getDelivery,
  listDeliveries,
  pickZipDestination,
  prepareDelivery,
} from "./client";
import {
  blockerTitle,
  defaultZipName,
  formatBytes,
  isStaleBaselineResponse,
  kindLabel,
  prepareKey,
} from "./coordination";
import type {
  DeliveryDto,
  DeliveryExportPreviewDto,
  DeliveryExportSaveDto,
  DeliveryPreviewDto,
  DeliverySummaryDto,
} from "./types";

export function DeliveryPreparePane({
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
  const [preview, setPreview] = useState<DeliveryPreviewDto | null>(null);
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
    prepareDelivery({ projectId, scopeModuleId: scope, artifactIds: selected })
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
    createDelivery({
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
      <p className="hint">
        Borrador desde lo guardado: no exige revisión. Los pendientes se muestran, no se ocultan.
      </p>
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
            Entrega de trabajo ({preview.entries.length} versiones)
          </h4>
          <p className="hint">
            Sin revisar: {preview.unreviewedCount} · con fuentes obsoletas: {preview.staleCount}
          </p>
          <table className="baseline-table">
            <thead>
              <tr>
                <th>Artefacto</th>
                <th>Tipo</th>
                <th>Versión</th>
                <th>Revisión</th>
                <th>Origen</th>
                <th>Fuentes</th>
              </tr>
            </thead>
            <tbody>
              {preview.entries.map((e) => (
                <tr key={e.artifact.id}>
                  <td title={e.artifact.title ?? e.artifact.id}>
                    {e.artifact.title ?? <code>{e.artifact.id}</code>}
                    {e.artifact.title !== null && e.artifact.title !== "" && (
                      <code>{e.artifact.id}</code>
                    )}
                  </td>
                  <td>{kindLabel(e.artifact.kind)}</td>
                  <td>
                    <code>{e.versionId}</code>
                  </td>
                  <td>{e.approvedBy ? `${e.approvedBy} (${e.approvedAt})` : "sin revisar"}</td>
                  <td>{e.provenance.kind === "human" ? `humana (${e.provenance.by})` : `IA (${e.provenance.by})`}</td>
                  <td>
                    {e.staleSources.length > 0 ? (
                      <span className="pill warn" title={e.staleSources.join(", ")}>
                        obsoletas
                      </span>
                    ) : (
                      "al día"
                    )}
                  </td>
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
                placeholder="p. ej. Borrador ventas 1"
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
              {busy === "creating" ? "Creando…" : "Crear entrega"}
            </button>
            {!preview.canCreate && <span className="hint">Resuelve los bloqueos para crearla.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function DeliveriesPane({
  projectId,
  focusId,
  onConsumedFocus,
}: {
  projectId: string;
  focusId: string | null;
  onConsumedFocus: () => void;
}) {
  const [list, setList] = useState<DeliverySummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliveryDto | null>(null);
  const [zip, setZip] = useState<DeliveryExportPreviewDto | null>(null);
  const [saved, setSaved] = useState<DeliveryExportSaveDto | null>(null);
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
      listDeliveries(projectId)
        .then((rows) => {
          if (key !== keyRef.current) return;
          setList(rows);
          setBusy(null);
          if (focus) {
            setSelectedId(focus);
            setNotice(
              "Entrega creada. Aún no se ha guardado ningún ZIP: elígela y usa «Guardar ZIP».",
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
    getDelivery(projectId, selectedId)
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
    exportDeliveryPreview(projectId, selectedId)
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
    exportDeliverySave({ projectId, deliveryId: selectedId, destPath, overwrite })
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
          {busy === "loading" && <li className="hint">Cargando entregas…</li>}
          {list.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={d.id === selectedId ? "active" : ""}
                onClick={() => {
                  setSelectedId(d.id);
                  setNotice(null);
                }}
              >
                <strong>{d.name}</strong>
                <code>{d.id}</code>
                <span className="hint">
                  {d.entryCount} versiones · sin revisar {d.unreviewedCount} · obsoletas{" "}
                  {d.staleCount} · {d.at}
                </span>
                {d.advanced && <span className="pill warn">el proyecto avanzó</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && busy === null && <li className="hint">Aún no hay entregas.</li>}
        </ul>
        <div className="baseline-detail">
          {!detail && busy !== "detail" && <p className="hint">Elige una entrega para verla.</p>}
          {busy === "detail" && <p className="hint">Cargando detalle…</p>}
          {detail && (
            <>
              <h4>
                {detail.name} <code>{detail.id}</code>
              </h4>
              {detail.description && <p>{detail.description}</p>}
              <p className="hint">
                Borrador de trabajo · {detail.at} ·{" "}
                {detail.scopeModuleId ? `módulo ${detail.scopeModuleId}` : "selección manual"} ·{" "}
                {detail.entries.length} versiones
              </p>
              <table className="baseline-table">
                <thead>
                  <tr>
                    <th>Artefacto</th>
                    <th>Tipo</th>
                    <th>Versión</th>
                    <th>Revisión</th>
                    <th>Fuentes</th>
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
                          : "sin revisar"}
                      </td>
                      <td>
                        {e.staleSources.length > 0 ? (
                          <span className="pill warn" title={e.staleSources.join(", ")}>
                            obsoletas
                          </span>
                        ) : (
                          "al día"
                        )}
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

function errorText(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Error inesperado.";
}

function errorKind(err: unknown): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return String((err as { kind: unknown }).kind);
  }
  return "";
}
