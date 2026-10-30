// Project overview: name, associated roots, detected stacks and
// analysis state. Manifest discovery is bounded and cancellable;
// analysis summaries come from the boards (never re-analyzed here).
import { useEffect, useMemo, useRef, useState } from "react";
import { allRootsOfProject } from "../code/archmap/projectMaps";
import { listCodeDir, readCodeFile } from "../code/client";
import type { CodeRootDto } from "../code/types";
import { readAnalysisSummaries } from "./analysisCache";
import { scanRootTech, type ManifestDeps, type RootTech } from "./manifestScan";

const REAL_SCAN_DEPS: ManifestDeps = {
  listDir: (rootId, rel) => listCodeDir(rootId, rel),
  readFile: (rootId, rel) => readCodeFile(rootId, rel),
};

interface OverviewViewProps {
  projectId: string;
  projectName: string;
  roots: CodeRootDto[];
  onOpenArchitecture: () => void;
  onAddFolder: () => void;
  scanDeps?: ManifestDeps;
}

export function OverviewView({
  projectId,
  projectName,
  roots,
  onOpenArchitecture,
  onAddFolder,
  scanDeps,
}: OverviewViewProps) {
  const projectRoots = useMemo(() => allRootsOfProject(roots, projectId), [roots, projectId]);
  const [tech, setTech] = useState<Record<string, RootTech>>({});
  const [scanning, setScanning] = useState(false);
  const [scanRun, setScanRun] = useState(0);
  const abortRef = useRef(false);
  const epochRef = useRef(0);
  const depsRef = useRef(scanDeps ?? REAL_SCAN_DEPS);
  depsRef.current = scanDeps ?? REAL_SCAN_DEPS;
  const summaries = useMemo(() => readAnalysisSummaries(), [projectRoots]);
  const rootsSig = projectRoots.map((root) => root.id).join(",");

  useEffect(() => {
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    abortRef.current = false;
    setScanning(true);
    setTech({});
    void (async () => {
      for (const root of projectRoots) {
        if (epochRef.current !== epoch) return;
        if (root.missing) continue;
        const found = await scanRootTech(root.id, depsRef.current, () => abortRef.current);
        if (epochRef.current !== epoch) return;
        setTech((prev) => ({ ...prev, [root.id]: found }));
        if (abortRef.current) break;
      }
      if (epochRef.current === epoch) setScanning(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rootsSig, scanRun]);

  return (
    <div className="overview">
      <div className="panel-head">
        <h2>{projectName}</h2>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={onAddFolder}>
            Add folder
          </button>
          <button type="button" className="primary small" onClick={onOpenArchitecture}>
            Open Architecture
          </button>
        </div>
      </div>
      {projectRoots.length === 0 ? (
        <p className="hint">
          No folders associated yet. Add folders from the explorer and associate them to see
          stacks and diagrams here.
        </p>
      ) : (
        <ul className="overview-roots">
          {projectRoots.map((root) => {
            const found = tech[root.id] ?? null;
            const scopes = summaries
              .filter((item) => item.rootId === root.id)
              .sort((a, b) => (a.scopeRel < b.scopeRel ? -1 : a.scopeRel > b.scopeRel ? 1 : 0));
            return (
              <li key={root.id} className="overview-root">
                <div className="overview-root-head">
                  <strong title={root.path}>{root.name}</strong>
                  {root.missing ? (
                    <span className="recent-missing" role="note">
                      Missing — relocate or remove it from the folders panel.
                    </span>
                  ) : found === null ? (
                    <span className="hint" role="status">
                      Detecting stacks…
                    </span>
                  ) : (
                    <span className="hint">
                      {found.techs.join(" · ")}
                      {found.truncated ? " · partial scan" : ""}
                    </span>
                  )}
                </div>
                {found !== null && found.manifests.length > 0 && (
                  <p className="hint" title={found.manifests.join("\n")}>
                    {found.manifests.length} manifest{found.manifests.length === 1 ? "" : "s"}:{" "}
                    {found.manifests.slice(0, 3).join(", ")}
                    {found.manifests.length > 3 ? ` +${found.manifests.length - 3}` : ""}
                  </p>
                )}
                {scopes.length === 0 ? (
                  <p className="hint">Not analyzed yet.</p>
                ) : (
                  <ul className="overview-scopes">
                    {scopes.map((summary) => (
                      <li key={`${summary.rootId}::${summary.scopeRel}`} className="hint">
                        {summary.scopeName} · {summary.files} files · {summary.edges} edges
                        {summary.truncated ? " · partial" : ""} · mapped{" "}
                        {new Date(summary.at).toLocaleTimeString()}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="button-row">
        {scanning ? (
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              abortRef.current = true;
            }}
          >
            Cancel detection
          </button>
        ) : (
          projectRoots.length > 0 && (
            <button type="button" className="secondary small" onClick={() => setScanRun((n) => n + 1)}>
              Re-detect stacks
            </button>
          )
        )}
      </div>
      <p className="hint">
        Detection reads file names and small manifests only (3 levels, 200 folders per root).
        It never runs project code.
      </p>
    </div>
  );
}
