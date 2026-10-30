// Own mockup catalog glyphs: original geometric drawings on a 24
// grid, round stroke, inherited color (`currentColor`). The `id` picks
// the glyph; an off-catalog id draws an explicit fallback (box with a
// question mark), never a silent substitute or saved SVG.
import type { ReactElement } from "react";
import { isMockupIcon } from "./mockupIcons";

type Glyph = ReactElement;

const GLYPHS: Record<string, Glyph> = {
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
      <path d="M14 7l3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  chevron_up: <path d="M6 14l6-6 6 6" />,
  chevron_down: <path d="M6 10l6 6 6-6" />,
  chevron_left: <path d="M14 6l-6 6 6 6" />,
  chevron_right: <path d="M10 6l6 6-6 6" />,
  arrow_left: (
    <>
      <path d="M20 12H5" />
      <path d="M10 6l-6 6 6 6" />
    </>
  ),
  arrow_right: (
    <>
      <path d="M4 12h15" />
      <path d="M14 6l6 6-6 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 3.5 19.5h17L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.5" r="0.5" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5V4z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  folder: <path d="M3 6h6l2 2h10v10H3V6z" />,
  file: (
    <>
      <path d="M6 3h8l4 4v14H6V3z" />
      <path d="M14 3v4h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="1" />
      <path d="M4 10h16" />
      <path d="M9 3v4M15 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-14 5.3" />
      <path d="M4 12a8 8 0 0 1 14-5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 20h14" />
    </>
  ),
  eye: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="1" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
};

function Fallback({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={`Icono no admitido: ${id}`}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" stroke="none" fill="currentColor">
        ?
      </text>
    </svg>
  );
}

export function MockupIcon({ id, label }: { id: string; label: string }) {
  if (!isMockupIcon(id)) return <Fallback id={id} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      {GLYPHS[id]}
    </svg>
  );
}
