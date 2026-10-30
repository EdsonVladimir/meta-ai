// Ruth IDE's single set of own icons (inline SVG, no third-party
// assets). Used by the code tree and the project explorer: every row
// always carries its folder, file or artifact icon. Decorative
// (`aria-hidden`): the visible name is already the accessible label,
// and badges are text (readable without color).
import { fileIconForName } from "./fileIconNames";

export type { CodeFileIconKind } from "./fileIconNames";

interface SizedIcon {
  size?: number;
  className?: string;
}

export function RuthFolderIcon({ open, size = 14, className = "code-file-icon" }: SizedIcon & { open: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <path d="M1.5 4.5h4l1.2 1.4h7.8v6.6h-13V4.5z" />
      ) : (
        <path d="M1.5 4.5h4l1.2 1.4h7.8v6.1h-13V4.5z" />
      )}
    </svg>
  );
}

export function RuthFileIcon({ name, size = 14, className = "code-file-icon" }: SizedIcon & { name: string }) {
  const icon = fileIconForName(name);
  return (
    <svg
      className={`${className} kind-${icon.kind}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 1.8h5.2L12 4.6V14.2H4V1.8z" />
      <path d="M9.2 1.8v2.8H12" />
      {icon.badge !== "" && (
        <text
          x="8"
          y="11.4"
          textAnchor="middle"
          fontSize="4.6"
          fontWeight="700"
          stroke="none"
          fill="currentColor"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
        >
          {icon.badge}
        </text>
      )}
    </svg>
  );
}

export function RuthOtherIcon({ size = 14, className = "code-file-icon" }: SizedIcon) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8 8 2.5z" />
    </svg>
  );
}

function Glyph12({ d, size = 13, className = "node-icon" }: SizedIcon & { d: string }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function RuthProjectIcon(props: SizedIcon) {
  return (
    <Glyph12
      {...props}
      d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3l1.5 2h3.5A1.5 1.5 0 0 1 12 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1 9.5v-6Z"
    />
  );
}

export function RuthModuleIcon(props: SizedIcon) {
  return <Glyph12 {...props} d="M6 1 11 3.5v5L6 11 1 8.5v-5L6 1Z M1 3.5 6 6l5-2.5 M6 6v5" />;
}

export function RuthRequirementIcon(props: SizedIcon) {
  return <Glyph12 {...props} d="M3 1.5h4.5L10 4v6.5H3V1.5Z M7.5 1.5V4H10" />;
}

export function RuthDesignIcon(props: SizedIcon) {
  return <Glyph12 {...props} d="M2 2h8v8H2z M2 5h8 M5 5v5" />;
}

export function RuthMockupIcon(props: SizedIcon) {
  return <Glyph12 {...props} d="M2 1.5h8v9H2z M2 3.5h8 M4 6.5h4" />;
}

/** Map visibility toggle: open eye (shown). */
export function RuthEyeIcon({ size = 13, className = "node-icon" }: SizedIcon) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className={className}>
      <path
        d="M1 6C2.5 3.5 4.3 2.5 6 2.5S9.5 3.5 11 6C9.5 8.5 7.7 9.5 6 9.5S2.5 8.5 1 6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Map visibility toggle: crossed eye (hidden). */
export function RuthEyeOffIcon({ size = 13, className = "node-icon" }: SizedIcon) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className={className}>
      <path
        d="M1 6C2.5 3.5 4.3 2.5 6 2.5S9.5 3.5 11 6C9.5 8.5 7.7 9.5 6 9.5S2.5 8.5 1 6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M1.5 10.5 10.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Informative row (loading/error/empty): ellipsis dots. */
export function RuthStatusIcon({ size = 13, className = "node-icon" }: SizedIcon) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className={className}>
      <circle cx="2.6" cy="6" r="1.1" fill="currentColor" />
      <circle cx="6" cy="6" r="1.1" fill="currentColor" />
      <circle cx="9.4" cy="6" r="1.1" fill="currentColor" />
    </svg>
  );
}
