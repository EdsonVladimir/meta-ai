// Versioned mockup types. They mirror the `ruth-api` DTOs (camelCase)
// and the `ruth-meta/src/mockup.rs` subset. Pure: no React, no Tauri.
// The adapter lives in client.ts.
import type { DesignContextPreview, DesignGenerationDto, DesignKind } from "../design/types";

export type MockupComponentKind =
  | "text"
  | "field"
  | "selector"
  | "button"
  | "table"
  | "container"
  | "icon";

export type MockupFieldType = "text" | "number" | "date" | "boolean";

export type MockupOrigin = "persisted" | "calculated" | "temporary" | "external" | "undefined";

export type MockupActionKind = "navigate" | "submit" | "open_dialog" | "cancel" | "business";

export type MockupButtonState = "enabled" | "disabled" | "loading" | "error";

export type MockupDirection = "vertical" | "horizontal";

export type MockupIconRole = "decorative" | "button" | "indicator";

export interface MockupComponent {
  id: string;
  kind: MockupComponentKind;
  text?: string;
  label?: string;
  name?: string;
  fieldType?: MockupFieldType;
  required: boolean;
  validations: string[];
  dataRef?: string;
  options: string[];
  columns: string[];
  columnTypes: MockupFieldType[];
  previewRows: string[][];
  rowActions: string[];
  actionKind?: MockupActionKind;
  operation?: string;
  target?: string;
  buttonState?: MockupButtonState;
  origin?: MockupOrigin;
  icon?: string;
  iconRole?: MockupIconRole;
  tooltip?: string;
  children: string[];
  direction?: MockupDirection;
  requirements: string[];
  designs: string[];
}

export interface MockupScreenState {
  id: string;
  label: string;
}

export interface MockupScreen {
  id: string;
  title: string;
  requirements: string[];
  designs: string[];
  states: MockupScreenState[];
  components: MockupComponent[];
}

export interface MockupSpec {
  title: string;
  screens: MockupScreen[];
}

export interface MockupContextPreview {
  requirements: DesignContextPreview[];
  designs: DesignContextPreview[];
  mockups: DesignContextPreview[];
}

export type { DesignGenerationDto, DesignKind };

/** Readable labels for components. */
export const MOCKUP_COMPONENT_LABELS: Record<MockupComponentKind, string> = {
  text: "Text",
  field: "Field",
  selector: "Selector",
  button: "Button",
  table: "Table",
  container: "Container",
  icon: "Icon",
};

/** Readable labels for declarative actions. */
export const MOCKUP_ACTION_LABELS: Record<MockupActionKind, string> = {
  navigate: "Navigate",
  submit: "Submit form",
  open_dialog: "Open dialog",
  cancel: "Cancel",
  business: "Business operation",
};

/** Readable labels for button states. */
export const MOCKUP_BUTTON_STATE_LABELS: Record<MockupButtonState, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  loading: "Loading",
  error: "Error",
};

/** Readable labels for container direction. */
export const MOCKUP_DIRECTION_LABELS: Record<MockupDirection, string> = {
  vertical: "Vertical",
  horizontal: "Horizontal",
};

/** Readable labels for icon roles. */
export const MOCKUP_ICON_ROLE_LABELS: Record<MockupIconRole, string> = {
  decorative: "Decorative",
  button: "Button",
  indicator: "Indicator",
};

/** Readable labels for visual field types. */
export const MOCKUP_FIELD_TYPE_LABELS: Record<MockupFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/no",
};

/** Readable labels for the declared data origin. */
export const MOCKUP_ORIGIN_LABELS: Record<MockupOrigin, string> = {
  persisted: "Saved",
  calculated: "Calculated",
  temporary: "Temporary",
  external: "External",
  undefined: "Undefined",
};

/** Create/save without declared sources but with cited references. */
export const MOCKUP_NO_SOURCES = "mockup_no_sources";

/** Declared sources stale on save. */
export const MOCKUP_STALE_SOURCES = "mockup_stale_sources";

/** Declared source missing on save. */
export const MOCKUP_SOURCE_MISSING = "mockup_source_missing";

/** Content that is not a valid mockup. */
export const MOCKUP_INVALID = "mockup_invalid";

/** The artifact is not a mockup. */
export const NOT_A_MOCKUP = "not_a_mockup";

/** Proposed screen: canonical spec of a ONE-screen mockup. */
export interface MockupScreenProposal {
  tempId: string;
  title: string;
  /** Canonical JSON ready to preview and incorporate. */
  spec: unknown;
  explanation: string;
  state: "pending" | "accepted" | "discarded";
  artifactId: string | null;
}

export interface MockupGenerationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/** Screen generation recorded with its exact original context. */
export interface MockupGeneration {
  id: string;
  projectId: string;
  moduleId: string;
  model: string;
  contextVersionIds: string[];
  templateVersion: number;
  usage: MockupGenerationUsage;
  createdAt: string;
  stale: boolean;
  questions: string[];
  proposals: MockupScreenProposal[];
}

export const MOCKUP_GENERATION_STALE = "mockup_generation_stale";
