// Active-file breadcrumbs: root, folders and file. Each folder reveals
// its tree node without changing the selection.
import { CodeFileIcon, CodeFolderIcon } from "./CodeFileIcon";

export interface CodeCrumb {
  label: string;
  /** Directory relative path (`""` is the root). */
  rel: string;
}

export function crumbsForRel(rootName: string, rel: string): { root: string; dirs: CodeCrumb[]; file: string } {
  const parts = rel === "" ? [] : rel.split("/");
  const file = parts.length === 0 ? rootName : (parts[parts.length - 1] ?? "");
  const dirs: CodeCrumb[] = parts.slice(0, -1).map((label, index) => ({
    label,
    rel: parts.slice(0, index + 1).join("/"),
  }));
  return { root: rootName, dirs, file };
}

interface CodeBreadcrumbsProps {
  rootId: string;
  rootName: string;
  rel: string;
  onRevealDir: (rootId: string, rel: string) => void;
  /** Active Architecture project in this root (marked, never navigated). */
  activeProjectRel?: string | null;
}

export function CodeBreadcrumbs({
  rootId,
  rootName,
  rel,
  onRevealDir,
  activeProjectRel,
}: CodeBreadcrumbsProps) {
  const crumbs = crumbsForRel(rootName, rel);
  const projectRel = activeProjectRel ?? null;
  return (
    <nav className="code-crumbs" aria-label="File path">
      <ol>
        <li>
          <button
            type="button"
            className={`code-crumb${projectRel === "" ? " code-crumb-active" : ""}`}
            onClick={() => onRevealDir(rootId, "")}
            title={
              projectRel === ""
                ? `${rootName} in the tree (active project)`
                : `Show ${rootName} in the tree`
            }
            aria-label={
              projectRel === ""
                ? `Show ${rootName} in the tree (active project)`
                : `Show ${rootName} in the tree`
            }
          >
            <CodeFolderIcon open={false} />
            <span className="code-crumb-label">{crumbs.root}</span>
          </button>
        </li>
        {crumbs.dirs.map((dir) => (
          <li key={dir.rel}>
            <span className="code-crumb-sep" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              className={`code-crumb${projectRel === dir.rel ? " code-crumb-active" : ""}`}
              onClick={() => onRevealDir(rootId, dir.rel)}
              title={
                projectRel === dir.rel
                  ? `Show ${dir.rel} in the tree (active project)`
                  : `Show ${dir.rel} in the tree`
              }
              aria-label={
                projectRel === dir.rel
                  ? `Show ${dir.rel} in the tree (active project)`
                  : `Show ${dir.rel} in the tree`
              }
            >
              <span className="code-crumb-label">{dir.label}</span>
            </button>
          </li>
        ))}
        <li aria-current="page">
          <span className="code-crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="code-crumb current" title={`${rootName} / ${rel}`}>
            <CodeFileIcon name={crumbs.file} />
            <span className="code-crumb-label">{crumbs.file}</span>
          </span>
        </li>
      </ol>
    </nav>
  );
}
