// Diálogo de archivo y borrado: resumen consultivo (contenido, dependientes,
// baselines, generaciones) y confirmación explícita por separado. La
// ejecución revalida las condiciones en Rust; ante un fallo el diálogo
// conserva el resumen y la selección sigue intacta.
import { useEffect } from "react";
import type { ArchivePreviewDto } from "./types";
import type { ArchiveAction, ArchiveTarget } from "./archive";

interface ArchiveDialogProps {
  target: ArchiveTarget;
  action: ArchiveAction;
  preview: ArchivePreviewDto | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onActionChange: (action: ArchiveAction) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function targetName(target: ArchiveTarget): string {
  return target.kind === "module" ? target.moduleId : target.artifactId;
}

function targetKind(target: ArchiveTarget): string {
  return target.kind === "module" ? "módulo" : "requisito";
}

function logLabel(log: string): string {
  return log === "design" ? "diseño" : "requisitos";
}

function roleLabel(role: string): string {
  if (role === "owns") return "generación del módulo";
  if (role === "context") return "citado en su contexto";
  if (role === "accepted") return "propuesta aceptada que lo creó";
  if (role === "target") return "actualización dirigida a él";
  return role;
}

function titleFor(target: ArchiveTarget, action: ArchiveAction): string {
  const what = `${targetKind(target)} ${targetName(target)}`;
  if (action === "archive") return `Archivar ${what}`;
  if (action === "restore") return `Restaurar ${what}`;
  return `Eliminar definitivamente ${what}`;
}

export function ArchiveDialog({
  target,
  action,
  preview,
  loading,
  busy,
  error,
  onActionChange,
  onConfirm,
  onRetry,
  onClose,
}: ArchiveDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label={titleFor(target, action)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{titleFor(target, action)}</h3>
          <button
            type="button"
            className="secondary small"
            onClick={onClose}
            disabled={busy}
            autoFocus
          >
            Cerrar
          </button>
        </div>
        {loading && <p className="hint">Cargando resumen…</p>}
        {error !== null && preview === null && (
          <div>
            <p className="error" role="alert">
              No se pudo cargar el resumen: {error}
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={onRetry}>
                Reintentar
              </button>
            </div>
          </div>
        )}
        {preview !== null && (
          <div>
            <p className="hint">
              Estado actual:{" "}
              <span className={preview.archived ? "archived-badge" : "review-badge ok"}>
                {preview.archived ? "archivado" : "activo"}
              </span>{" "}
              · {preview.versions} {preview.versions === 1 ? "versión" : "versiones"} ·{" "}
              {preview.approvals} {preview.approvals === 1 ? "aprobación" : "aprobaciones"}
            </p>
            {preview.kind === "module" && (
              <section aria-label="Contenido del módulo">
                <h4>Contenido ({preview.contents.length})</h4>
                {preview.contents.length === 0 ? (
                  <p className="hint">Módulo vacío.</p>
                ) : (
                  <ul className="archive-list">
                    {preview.contents.map((item) => (
                      <li key={item.id}>
                        <code>{item.id}</code> <span className="kind-badge">{item.kind}</span>
                        {item.archived && <span className="archived-badge">archivado</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section aria-label="Dependientes">
              <h4>Dependientes ({preview.dependents.length})</h4>
              {preview.dependents.length === 0 ? (
                <p className="hint">Ningún artefacto depende de este {targetKind(target)}.</p>
              ) : (
                <ul className="archive-list">
                  {preview.dependents.map((dep) => (
                    <li key={dep.artifact.id}>
                      <code>{dep.artifact.id}</code> <span className="kind-badge">{dep.artifact.kind}</span>{" "}
                      <span className="hint">
                        {dep.sameModule ? "este módulo" : `módulo ${dep.artifact.moduleId}`}
                      </span>
                      {dep.artifact.archived && <span className="archived-badge">archivado</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Baselines">
              <h4>Baselines ({preview.baselines.length})</h4>
              {preview.baselines.length === 0 ? (
                <p className="hint">Ninguna baseline lo incluye.</p>
              ) : (
                <div>
                  <ul className="archive-list">
                    {preview.baselines.map((base) => (
                      <li key={base.id}>
                        <code>{base.name}</code> <span className="hint">{base.id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">
                    Históricas e inmutables: seguirán consultables y exportables.
                  </p>
                </div>
              )}
            </section>
            <section aria-label="Entregas de trabajo">
              <h4>Entregas de trabajo ({preview.deliveries.length})</h4>
              {preview.deliveries.length === 0 ? (
                <p className="hint">Ninguna entrega de trabajo lo incluye.</p>
              ) : (
                <div>
                  <ul className="archive-list">
                    {preview.deliveries.map((delivery) => (
                      <li key={delivery.id}>
                        <code>{delivery.name}</code>{" "}
                        <span className="hint">{delivery.id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">
                    Las entregas protegen su contenido igual que las baselines.
                  </p>
                </div>
              )}
            </section>
            <section aria-label="Generaciones">
              <h4>Generaciones ({preview.generations.length})</h4>
              {preview.generations.length === 0 ? (
                <p className="hint">Ninguna generación lo menciona.</p>
              ) : (
                <ul className="archive-list">
                  {preview.generations.map((gen) => (
                    <li key={`${gen.log}:${gen.id}:${gen.role}`}>
                      <code>{gen.id}</code>{" "}
                      <span className="hint">
                        {logLabel(gen.log)} · {roleLabel(gen.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {error !== null && (
              <p className="error" role="alert">
                No se pudo completar: {error} Nada ha cambiado.
              </p>
            )}
            <ArchiveActions
              target={target}
              action={action}
              preview={preview}
              busy={busy}
              onActionChange={onActionChange}
              onConfirm={onConfirm}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ArchiveActions({
  target,
  action,
  preview,
  busy,
  onActionChange,
  onConfirm,
  onClose,
}: {
  target: ArchiveTarget;
  action: ArchiveAction;
  preview: ArchivePreviewDto;
  busy: boolean;
  onActionChange: (action: ArchiveAction) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const what = targetKind(target);
  if (action === "delete") {
    if (!preview.canDelete) {
      return (
        <div>
          <div className="archive-blocked" role="note">
            <p>
              <strong>No se puede eliminar «{targetName(target)}».</strong>
            </p>
            <ul>
              {preview.deleteBlockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          </div>
          <div className="modal-actions">
            {!preview.archived && (
              <button
                type="button"
                className="primary"
                onClick={() => onActionChange("archive")}
                disabled={busy}
              >
                Archivar en su lugar
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cerrar
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="archive-danger" role="note">
          <p>
            <strong>«{targetName(target)}» se eliminará definitivamente</strong>
            {preview.kind === "module"
              ? " (módulo vacío, sin referencias)."
              : ` con sus ${preview.versions} ${preview.versions === 1 ? "versión" : "versiones"}.`}
          </p>
          <p>
            Sin aprobaciones, sin dependientes, sin baselines y sin menciones en
            generaciones. Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Eliminando…" : `Eliminar definitivamente «${targetName(target)}»`}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="hint">
        {action === "archive"
          ? `Se ocultará de las listas activas. Conserva versiones, aprobaciones, dependencias, ` +
            `baselines y generaciones, y podrás consultar su historial. No podrás editar, generar ` +
            `ni aprobar sobre ${targetName(target)} hasta restaurarlo.`
          : `Volverá a las listas activas con todo su historial intacto.${
              preview.kind === "module"
                ? " Lo archivado individualmente dentro seguirá archivado."
                : ""
            }`}
      </p>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
          {busy
            ? action === "archive"
              ? "Archivando…"
              : "Restaurando…"
            : action === "archive"
              ? `Archivar ${what} «${targetName(target)}»`
              : `Restaurar ${what} «${targetName(target)}»`}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
