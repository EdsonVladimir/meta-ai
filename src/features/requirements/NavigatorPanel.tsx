import type { ArtifactDto, ModuleDto, ProjectDto } from "./types";

interface NavigatorPanelProps {
  projects: ProjectDto[];
  modules: ModuleDto[];
  requirements: ArtifactDto[];
  designs: ArtifactDto[];
  projectId: string | null;
  moduleId: string | null;
  requirementId: string | null;
  designId: string | null;
  busy: boolean;
  error: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectModule: (moduleId: string) => void;
  onSelectRequirement: (requirementId: string) => void;
  onSelectDesign: (designId: string) => void;
  onCreateProject: () => void;
  onCreateModule: () => void;
  onNewRequirement: () => void;
  onProposeRequirements: () => void;
}

export function NavigatorPanel({
  projects,
  modules,
  requirements,
  designs,
  projectId,
  moduleId,
  requirementId,
  designId,
  busy,
  error,
  onSelectProject,
  onSelectModule,
  onSelectRequirement,
  onSelectDesign,
  onCreateProject,
  onCreateModule,
  onNewRequirement,
  onProposeRequirements,
}: NavigatorPanelProps) {
  return (
    <nav className="navigator" aria-label="Proyectos, módulos y artefactos">
      <section>
        <div className="nav-head">
          <h3>Proyecto</h3>
          <button type="button" className="secondary small" onClick={onCreateProject} disabled={busy}>
            + Proyecto
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="hint">Sin proyectos. Crea el primero para empezar.</p>
        ) : (
          <ul className="pick-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={p.id === projectId ? "picked" : undefined}
                  onClick={() => onSelectProject(p.id)}
                  aria-current={p.id === projectId}
                >
                  <code>{p.id}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="nav-head">
          <h3>Módulo</h3>
          <button
            type="button"
            className="secondary small"
            onClick={onCreateModule}
            disabled={busy || projectId === null}
            title={projectId === null ? "Selecciona un proyecto primero" : undefined}
          >
            + Módulo
          </button>
        </div>
        {projectId === null ? (
          <p className="hint">Selecciona un proyecto.</p>
        ) : modules.length === 0 ? (
          <p className="hint">Sin módulos. Crea el primero.</p>
        ) : (
          <ul className="pick-list">
            {modules.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={m.id === moduleId ? "picked" : undefined}
                  onClick={() => onSelectModule(m.id)}
                  aria-current={m.id === moduleId}
                >
                  <code>{m.id}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="nav-head">
          <h3>Requisitos</h3>
          <button
            type="button"
            className="secondary small"
            onClick={onNewRequirement}
            disabled={busy || moduleId === null}
            title={moduleId === null ? "Selecciona un módulo primero" : undefined}
          >
            + Requisito
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={onProposeRequirements}
            disabled={busy || moduleId === null}
            title={
              moduleId === null
                ? "Selecciona un módulo primero"
                : "Proponer requisitos con IA para este módulo"
            }
          >
            Proponer con IA
          </button>
        </div>
        {moduleId === null ? (
          <p className="hint">Selecciona un módulo.</p>
        ) : requirements.length === 0 ? (
          <p className="hint">Sin requisitos. Crea el primero.</p>
        ) : (
          <ul className="pick-list">
            {requirements.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={r.id === requirementId ? "picked" : undefined}
                  onClick={() => onSelectRequirement(r.id)}
                  aria-current={r.id === requirementId}
                >
                  <code>{r.id}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="nav-head">
          <h3>Diseño</h3>
        </div>
        {moduleId === null ? (
          <p className="hint">Selecciona un módulo.</p>
        ) : designs.length === 0 ? (
          <p className="hint">Sin diseños. Genera el primero en la vista Diseño.</p>
        ) : (
          <ul className="pick-list">
            {designs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={d.id === designId ? "picked" : undefined}
                  onClick={() => onSelectDesign(d.id)}
                  aria-current={d.id === designId}
                >
                  <code>{d.id}</code>{" "}
                  <span className="kind-badge">
                    {d.kind === "flow" ? "flujo" : d.kind === "data_model" ? "datos" : d.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </nav>
  );
}
