// Classic Code perspective (tree + editor together): composition of
// the provider and both panes. The app uses it split into slots
// (contextual left + center); this composition stays for tests and as
// a reusable unit.
import { CodeWorkspaceProvider, type CodeWorkspaceStateArgs } from "./useCodeWorkspace";
import { CodeMainPane } from "./CodeMainPane";
import { CodeTreePane } from "./CodeTreePane";

export type { CodeSaveApi } from "./useCodeWorkspace";

export function CodeWorkspace({ ...args }: CodeWorkspaceStateArgs) {
  return (
    <CodeWorkspaceProvider {...args}>
      <div className="code-workspace">
        <aside className="code-side" aria-label="Code folders">
          <CodeTreePane />
        </aside>
        <CodeMainPane />
      </div>
    </CodeWorkspaceProvider>
  );
}
