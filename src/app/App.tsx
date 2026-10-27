import { ConnectionPanel } from "../features/connection/ConnectionPanel";
import { RequirementsWorkspace } from "../features/requirements/RequirementsWorkspace";
import { useRequirementsUi } from "../features/requirements/uiStore";

export function App() {
  return (
    <div className="page wide app">
      <header className="topbar">
        <div className="brand-mini">
          <span className="logo" aria-hidden="true">
            R
          </span>
          <h1>Ruth IDE</h1>
        </div>
        <Breadcrumb />
        <div className="topbar-right">
          <details className="conn-details">
            <summary title="Conexión con Meta">Conexión</summary>
            <div className="conn-popover">
              <ConnectionPanel />
            </div>
          </details>
        </div>
      </header>
      <main>
        <RequirementsWorkspace />
      </main>
    </div>
  );
}

function Breadcrumb() {
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  return (
    <nav className="breadcrumb" aria-label="Ubicación">
      {projectId ? <code>{projectId}</code> : <span className="hint">Sin proyecto</span>}
      {moduleId && (
        <>
          {" / "}
          <code>{moduleId}</code>
        </>
      )}
    </nav>
  );
}
