// Architecture view: the automatic project boards, with the manual
// scope analysis tucked behind an on-demand toggle. The boards own their
// toolbar (filters, search, edges, module, details); this view only
// keeps the shared zoom so scope switches never reset it. Saved
// content only; drafts warn where analyzed.
import { useCallback, useState } from "react";
import { useCodeWorkspace } from "../useCodeWorkspace";
import { useRequirementsUi } from "../../requirements/uiStore";
import { StructureView, scopeKey, type ScopeFile } from "../structure/StructureView";
import { CodeProposalDialog } from "../structure/CodeProposalDialog";
import type { CodeGenerationDto, CodeProposalFileDto } from "../types";
import { ProjectMapView } from "./ProjectMapView";

export function ArchitectureView() {
  const {
    desktop,
    roots,
    tabs,
    analyzeTs,
    scope,
    setScope,
    handleAddActiveFile,
    handleAddActiveFolder,
    openFileByRef,
    notifyFileChanged,
    prefs,
    loader,
    selectedProjectId,
    selectedModuleId,
  } = useCodeWorkspace();
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const hidden = useRequirementsUi((s) => s.mapHiddenRoots);
  const toggleMapRoot = useRequirementsUi((s) => s.toggleMapRoot);
  const archScope = useRequirementsUi((s) => s.archScope);
  const setArchScope = useRequirementsUi((s) => s.setArchScope);
  const hiddenProjects = useRequirementsUi((s) => s.mapHiddenProjects);
  const showAllMapProjects = useRequirementsUi((s) => s.showAllMapProjects);
  const toggleMapProject = useRequirementsUi((s) => s.toggleMapProject);
  // One zoom level for the architecture boards. It lives here so
  // switching scopes or panels never resets it.
  const [zoom, setZoom] = useState(1);
  // Manual scope analysis: closed by default. Once opened it stays
  // mounted (hidden when closed) so its selection and results survive.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMounted, setManualMounted] = useState(false);
  // Muse proposal: the dialog reports each generation; its pending
  // files overlay the boards until the dialog closes or clears.
  const [proposeOpen, setProposeOpen] = useState(false);
  /** The dialog steps aside for the X-ray but stays mounted with its proposal. */
  const [proposeHidden, setProposeHidden] = useState(false);
  /** Files of the chain on screen: what Muse reads when no scope was chosen. */
  const [chainFiles, setChainFiles] = useState<ScopeFile[]>([]);
  const [proposalFiles, setProposalFiles] = useState<CodeProposalFileDto[] | null>(null);
  const handleGeneration = useCallback((generation: CodeGenerationDto | null): void => {
    setProposalFiles(generation === null ? null : generation.files);
  }, []);

  if (!desktop) {
    return <p className="hint">Architecture needs the Ruth IDE desktop app.</p>;
  }
  if (projectId === null) {
    return <p className="hint">Select a project to see its architecture.</p>;
  }
  const rootNames = Object.fromEntries(roots.map((root) => [root.id, root.name]));
  const canPropose = selectedProjectId !== null && selectedModuleId !== null;
  const proposalScope = scope.length > 0 ? scope : chainFiles;
  return (
    <div className="architecture">
      <ProjectMapView
        projectId={projectId}
        roots={roots}
        hidden={hidden}
        onToggleRoot={toggleMapRoot}
        tabs={tabs}
        zoom={zoom}
        onZoomChange={setZoom}
        scope={archScope}
        onScopeChange={setArchScope}
        hiddenProjects={hiddenProjects}
        onShowAllProjects={showAllMapProjects}
        onToggleProject={toggleMapProject}
        proposalFiles={proposalFiles}
        onOpenProposal={() => setProposeHidden(false)}
        onCloseProposal={() => {
          setProposeOpen(false);
          setProposeHidden(false);
          setProposalFiles(null);
        }}
        onChainFiles={setChainFiles}
      />
      <div className="architecture-actions">
        <button
          type="button"
          className="secondary small architecture-manual-toggle"
          aria-expanded={manualOpen}
          aria-controls="architecture-manual"
          title="Analyze chosen files by hand, propose code, link symbols and keep snapshots."
          onClick={() => {
            setManualMounted(true);
            setManualOpen((prev) => !prev);
          }}
        >
          <span aria-hidden="true">{manualOpen ? "▾" : "▸"}</span> Manual analysis
        </button>
        <button
          type="button"
          className="secondary small"
          disabled={!canPropose}
          title={
            canPropose
              ? `Muse reads ${proposalScope.length} file(s): the chain on screen, or your manual scope`
              : "Select a project and a module to propose with Muse"
          }
          onClick={() => {
            setProposeOpen(true);
            setProposeHidden(false);
          }}
        >
          Propose with Muse
        </button>
      </div>
      {proposeOpen && canPropose && (
        <CodeProposalDialog
          projectId={selectedProjectId}
          moduleId={selectedModuleId}
          scope={proposalScope}
          rootNames={rootNames}
          baseline={null}
          current={null}
          onReanalyze={async () => {}}
          onFileAccepted={notifyFileChanged}
          onGeneration={handleGeneration}
          onViewOnXray={() => setProposeHidden(true)}
          hidden={proposeHidden}
          onClose={() => setProposeOpen(false)}
          prefs={prefs}
          loader={loader}
        />
      )}
      {manualMounted && (
        <section
          id="architecture-manual"
          className="architecture-scope"
          aria-label="Manual scope analysis"
          hidden={!manualOpen}
        >
          <StructureView
            scope={scope}
            rootNames={rootNames}
            onRemoveScope={(key) =>
              setScope((prev) => prev.filter((file) => scopeKey(file) !== key))
            }
            onAddActiveFile={handleAddActiveFile}
            onAddActiveFolder={handleAddActiveFolder}
            tabs={tabs}
            onOpenFile={openFileByRef}
            analyzeTs={analyzeTs}
            projectId={selectedProjectId}
            moduleId={selectedModuleId}
            onFileChanged={notifyFileChanged}
            prefs={prefs}
            loader={loader}
          />
        </section>
      )}
    </div>
  );
}
