// Central view tabs: project views only. Welcome has no tab (it is the
// launch state); files open as document tabs above every view, so no
// "code" tab is needed to reach them. Overview is always first: the
// visible way back to the project summary.
import type { CenterView } from "./uiStore";

interface PerspectiveTabsProps {
  centerView: CenterView;
  /** Project and module selected (what the design views require). */
  ready: boolean;
  /** Project selected (what Overview and Architecture require). */
  projectReady: boolean;
  onSelect: (view: CenterView) => void;
}

const TABS: Array<{
  view: CenterView;
  label: string;
  needsProject: boolean;
  projectOnly?: boolean;
}> = [
  { view: "overview", label: "Overview", needsProject: true, projectOnly: true },
  { view: "requirements", label: "Requirements", needsProject: true },
  { view: "design", label: "Design", needsProject: true },
  { view: "impact", label: "Impact", needsProject: true },
  { view: "mockups", label: "Mockups", needsProject: true },
  { view: "architecture", label: "Architecture", needsProject: true, projectOnly: true },
  { view: "traceability", label: "Traceability", needsProject: true },
];

export function PerspectiveTabs({ centerView, ready, projectReady, onSelect }: PerspectiveTabsProps) {
  return (
    <div className="center-tabs" role="tablist" aria-label="Views">
      {TABS.map((tab) => {
        const disabled =
          tab.needsProject && (tab.projectOnly === true ? !projectReady : !ready);
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={centerView === tab.view}
            className={centerView === tab.view ? "active" : ""}
            onClick={() => onSelect(tab.view)}
            disabled={disabled}
            title={
              disabled
                ? tab.projectOnly === true
                  ? "Select a project first"
                  : "Select a project and a module"
                : tab.view === "overview"
                  ? "Project summary: roots, detected stacks, analysis state"
                  : tab.view === "architecture"
                    ? "Automatic diagrams of the project folders"
                    : undefined
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
