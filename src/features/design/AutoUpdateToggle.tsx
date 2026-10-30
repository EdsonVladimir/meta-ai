// AI auto-update switch, per module and per session. Off by default:
// enabling it shows what will be sent to Meta. While on, each manual
// save schedules (batching) update proposals for stale designs. Pure
// presentation: scheduling and execution live in the workspace.
export interface AutoStatus {
  message: string;
  kind: "working" | "ok" | "error";
}

interface AutoUpdateToggleProps {
  moduleName: string;
  enabled: boolean;
  disabled: boolean;
  disabledTitle?: string;
  status: AutoStatus | null;
  onToggle: (enabled: boolean) => void;
}

export function AutoUpdateToggle({
  moduleName,
  enabled,
  disabled,
  disabledTitle,
  status,
  onToggle,
}: AutoUpdateToggleProps) {
  return (
    <div className="auto-update">
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>Automatic AI update</span>
      </label>
      <details>
        <summary>What is sent to Meta?</summary>
        <p className="hint">
          When saving in {moduleName}, Ruth IDE will propose updating the
          designs left stale. The saved versions of the requirements and
          designs involved are sent (never unsaved drafts or other
          modules). At most 5 proposals per cycle, one at a time. Results
          go to separate proposals in Impact: nothing is overwritten or
          accepted alone.
        </p>
      </details>
      {status !== null && (
        <p
          className={status.kind === "error" ? "error" : "hint"}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.kind === "working" ? "… " : ""}
          {status.message}
        </p>
      )}
    </div>
  );
}
