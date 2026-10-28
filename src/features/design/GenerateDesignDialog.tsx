// Diálogo «Generar diseño»: el selector completo de fuentes y todas las
// capacidades de generación y revisión del panel, con requisitos
// preseleccionados desde el contexto. Nunca genera solo.
import { useEffect } from "react";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";
import { DesignPanel } from "./DesignPanel";

interface GenerateDesignDialogProps {
  projectId: string;
  moduleId: string;
  artifacts: ArtifactDto[];
  /** Requisitos premarcados (null = todos los guardados). */
  preselected: string[] | null;
  /** Mockups premarcados (null = ninguno; se eligen a mano). */
  preselectedMockups?: string[] | null;
  onClose: () => void;
  onAccepted: (detail: RequirementDetail) => void;
  onOpenDesign: (designId: string) => void;
}

export function GenerateDesignDialog({
  projectId,
  moduleId,
  artifacts,
  preselected,
  preselectedMockups = null,
  onClose,
  onAccepted,
  onOpenDesign,
}: GenerateDesignDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Generar diseño"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Generar diseño</h3>
          <button type="button" className="secondary small" onClick={onClose} autoFocus>
            Cerrar
          </button>
        </div>
        <DesignPanel
          key={`${moduleId}:${(preselected ?? []).join(",")}:${(preselectedMockups ?? []).join(",")}`}
          projectId={projectId}
          moduleId={moduleId}
          artifacts={artifacts}
          preselectedRequirementIds={preselected}
          preselectedMockupIds={preselectedMockups}
          onAccepted={onAccepted}
          onOpenDesign={onOpenDesign}
        />
      </div>
    </div>
  );
}
