// One member row on a board card: role icon, highlighted name,
// secondary signature and badges for what the code wrote (visibility,
// static/async/readonly) or the analysis proved (lifecycle hooks).
// Nothing absent from the extraction is shown: no implied `public`,
// no inferred return types. The full signature lives in the tooltip
// and, for selectable rows, in the inspector.
import type { StructureMember } from "../structure/structureTypes";
import {
  MEMBER_ROLE_ICON,
  MEMBER_ROLE_LABEL,
  memberLabel,
  memberModifiers,
  type LifecycleHook,
  type MemberRole,
} from "./memberRoles";

export interface MemberRowProps {
  member: StructureMember;
  role: MemberRole;
  /** Evidence when the row is a detected lifecycle hook. */
  hook?: LifecycleHook | null;
  /** Indented under a symbol row (file cards). */
  indent?: boolean;
  /** Selectable rows (symbol cards) open their detail in the inspector. */
  selected?: boolean;
  onSelect?: () => void;
  /** Rendered inside a `role="list"` container. */
  listItem?: boolean;
}

export function memberTooltip(member: StructureMember, role: MemberRole, hook?: LifecycleHook | null): string {
  const lines = [`${MEMBER_ROLE_LABEL[role]}: ${memberLabel(member)}`];
  if (hook !== null && hook !== undefined) lines.push(`${hook.framework} lifecycle hook (${hook.evidence})`);
  return lines.join("\n");
}

export function MemberRow({ member, role, hook, indent, selected, onSelect, listItem }: MemberRowProps) {
  const modifiers = memberModifiers(member);
  const tooltip = memberTooltip(member, role, hook);
  const className = `archboard-member mrole-${role}${selected === true ? " selected" : ""}`;
  const slotClass = `archboard-member-slot${indent === true ? " indent" : ""}`;
  const body = (
    <>
      <span className={`archboard-mem-icon mrole-${role}`} aria-hidden="true">
        <MemberIcon role={role} />
      </span>
      <span className="archboard-mem-text">
        <span className="archboard-mem-name">{member.name}</span>
        {member.detail !== "" && (
          <span className={`archboard-mem-sig${/^[(:]/.test(member.detail) ? " tight" : ""}`}>
            {member.detail}
          </span>
        )}
      </span>
      <span className="archboard-mem-tags">
        {role === "lifecycle" && <span className="archboard-tag hook">hook</span>}
        {member.visibility !== undefined && (
          <span className={`archboard-tag vis-${member.visibility}`}>{member.visibility}</span>
        )}
        {modifiers.map((modifier) => (
          <span key={modifier} className="archboard-tag mod">
            {modifier}
          </span>
        ))}
      </span>
    </>
  );
  const row =
    onSelect === undefined ? (
      <div className={className} title={tooltip}>
        {body}
      </div>
    ) : (
      <button
        type="button"
        className={className}
        title={tooltip}
        aria-label={tooltip.replace("\n", ". ")}
        aria-pressed={selected === true}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {body}
      </button>
    );
  return (
    <div className={slotClass} role={listItem === true ? "listitem" : undefined}>
      {row}
    </div>
  );
}

/**
 * Small role glyphs: a cube for callables (methods, hooks,
 * constructors; the color and the label tell them apart), a field
 * bar for properties, and the role letter for the rest.
 */
function MemberIcon({ role }: { role: MemberRole }) {
  if (role === "method" || role === "lifecycle" || role === "constructor") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5z" />
        <path d="M2.6 5.1 8 8.2l5.4-3.1M8 8.2v5.8" />
      </svg>
    );
  }
  if (role === "property") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2.2" y="4.2" width="11.6" height="7.6" rx="1.6" />
        <path d="M5 8h6" />
      </svg>
    );
  }
  return <>{MEMBER_ROLE_ICON[role]}</>;
}
