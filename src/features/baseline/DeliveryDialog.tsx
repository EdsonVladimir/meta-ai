// Work delivery panels (draft): prepare from saved versions without requiring
// approval, create with an explicit human action, and export to ZIP.
// Historical baselines stay intact; here “coherent” and “verified” are never
// said: the UI shows pending items, unreviewed versions and stale sources.
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
        Draft from saved work: requires no review. Pending items show, never hide.
      </p>
      <div className="baseline-row">
        <label>
          Scope module
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
        <legend>Module artifacts ({selected.length} picked)</legend>
        {busy === "loading" && <p className="hint">Loading artifacts…</p>}
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
        {artifacts.length === 0 && busy === null && <p className="hint">No artifacts in this module.</p>}
      </fieldset>
      <div className="modal-actions">
        <button type="button" onClick={runPrepare} disabled={busy !== null || selected.length === 0}>
          {busy === "preparing" ? "Preparing…" : "Preview"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          {conflict && (
            <>
              {" "}
              <button type="button" className="ghost" onClick={runPrepare}>
                Prepare again
              </button>
            </>
          )}
        </p>
      )}
      {preview && (
        <div className="baseline-preview">
          <h4>
            Work delivery ({preview.entries.length} versions)
          </h4>
          <p className="hint">
            Unreviewed: {preview.unreviewedCount} · with stale sources: {preview.staleCount}
          </p>
          <table className="baseline-table">
            <thead>
              <tr>
                <th>Artifact</th>
                <th>Kind</th>
                <th>Version</th>
                <th>Review</th>
                <th>Origin</th>
                <th>Sources</th>
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
                  <td>{e.approvedBy ? `${e.approvedBy} (${e.approvedAt})` : "unreviewed"}</td>
                  <td>{e.provenance.kind === "human" ? `human (${e.provenance.by})` : `AI (${e.provenance.by})`}</td>
                  <td>
                    {e.staleSources.length > 0 ? (
                      <span className="pill warn" title={e.staleSources.join(", ")}>
                        stale
                      </span>
                    ) : (
                      "current"
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
              Out of scope:{" "}
              {[
                ...preview.outOfScope.artifacts,
                ...preview.outOfScope.modules.flatMap((m) => m.artifacts),
              ].join(", ")}
            </p>
          )}
          <div className="baseline-row">
            <label>
              Delivery name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales draft 1"
                maxLength={120}
                disabled={busy !== null}
              />
            </label>
            <label>
              Description (optional)
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
              {busy === "creating" ? "Creating…" : "Create delivery"}
            </button>
            {!preview.canCreate && <span className="hint">Resolve the blockers to create it.</span>}
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
              "Delivery created. No ZIP saved yet: pick it and use \u201cSave ZIP\u201d.",
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
    if (dest === null) return; // Cancelling writes nothing and reports no success.
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
          {busy === "loading" && <li className="hint">Loading deliveries…</li>}
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
                  {d.entryCount} versions · unreviewed {d.unreviewedCount} · stale{" "}
                  {d.staleCount} · {d.at}
                </span>
                {d.advanced && <span className="pill warn">the project moved on</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && busy === null && <li className="hint">No deliveries yet.</li>}
        </ul>
        <div className="baseline-detail">
          {!detail && busy !== "detail" && <p className="hint">Pick a delivery to see it.</p>}
          {busy === "detail" && <p className="hint">Loading detail…</p>}
          {detail && (
            <>
              <h4>
                {detail.name} <code>{detail.id}</code>
              </h4>
              {detail.description && <p>{detail.description}</p>}
              <p className="hint">
                Work draft · {detail.at} ·{" "}
                {detail.scopeModuleId ? `module ${detail.scopeModuleId}` : "manual selection"} ·{" "}
                {detail.entries.length} versions
              </p>
              <table className="baseline-table">
                <thead>
                  <tr>
                    <th>Artifact</th>
                    <th>Kind</th>
                    <th>Version</th>
                    <th>Review</th>
                    <th>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entries.map((e) => (
                    <tr key={e.artifact.id}>
                      <td title={e.title ?? e.artifact.id}>
                        {e.title ?? <code>{e.artifact.id}</code>}
                        {e.title !== null && e.title !== "" && <code>{e.artifact.id}</code>}{" "}
                        {e.title !== null && e.title !== "" && (
                          <span className="hint">(pinned in the delivery)</span>
                        )}
                        {e.title !== e.artifact.title &&
                          e.artifact.title !== null &&
                          e.artifact.title !== "" && (
                            <span className="hint"> · today: {e.artifact.title}</span>
                          )}
                      </td>
                      <td>{kindLabel(e.kind)}</td>
                      <td>
                        <code>{e.versionId}</code>
                      </td>
                      <td>
                        {e.approvals.length > 0
                          ? e.approvals.map((a) => `${a.approvedBy} (${a.at})`).join("; ")
                          : "unreviewed"}
                      </td>
                      <td>
                        {e.staleSources.length > 0 ? (
                          <span className="pill warn" title={e.staleSources.join(", ")}>
                            stale
                          </span>
                        ) : (
                          "current"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="modal-actions">
                <button type="button" onClick={runPreview} disabled={busy !== null}>
                  {busy === "preview" ? "Preparing…" : "ZIP preview"}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={runSave}
                  disabled={busy !== null || zip === null}
                  title={zip === null ? "Look at the package preview first" : undefined}
                >
                  {busy === "saving" ? "Saving…" : "Save ZIP"}
                </button>
              </div>
              {zip && (
                <div className="baseline-preview">
                  <h4>
                    Package ({zip.files.length} files, {formatBytes(zip.totalBytes)})
                  </h4>
                  <table className="baseline-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Size</th>
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
                    Hashes verify integrity; they are not a digital signature.
                  </p>
                </div>
              )}
              {pendingPath && (
                <div className="baseline-confirm" role="alert">
                  <p>
                    <code>{pendingPath}</code> already exists. Replace it?
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => saveTo(pendingPath, true)}
                      disabled={busy !== null}
                    >
                      Replace
                    </button>
                    <button type="button" className="ghost" onClick={() => setPendingPath(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {saved && (
                <p className="notice" role="status">
                  ZIP saved to <code>{saved.path}</code> ({formatBytes(saved.bytes)}). SHA-256:{" "}
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
  return "Unexpected error.";
}

function errorKind(err: unknown): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return String((err as { kind: unknown }).kind);
  }
  return "";
}
