// "Generate design" dialog: the full source picker and all the panel
// generation and review capabilities, with preselected requirements
// from context. It never generates alone.
import { useEffect } from "react";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";
import { DesignPanel } from "./DesignPanel";

interface GenerateDesignDialogProps {
  projectId: string;
  moduleId: string;
  artifacts: ArtifactDto[];
  /** Preselected requirements (null = every saved one). */
  preselected: string[] | null;
  /** Preselected mockups (null = none; picked by hand). */
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
        aria-label="Generate design"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Generate design</h3>
          <button type="button" className="secondary small" onClick={onClose} autoFocus>
            Close
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
