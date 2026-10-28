// Tipos de mockups versionados. Reflejan los DTOs de `ruth-api`
// (camelCase) y el subconjunto de `ruth-meta/src/mockup.rs`.
// Puros: sin React, sin Tauri. El adaptador vive en client.ts.
import type { DesignContextPreview, DesignGenerationDto, DesignKind } from "../design/types";

export type MockupKind = "mockup";

export type MockupComponentKind = "text" | "field" | "selector" | "button" | "table";

export type MockupFieldType = "text" | "number" | "date" | "boolean";

export type MockupOrigin = "persisted" | "calculated" | "temporary" | "external" | "undefined";

export interface MockupComponent {
  id: string;
  kind: MockupComponentKind;
  text?: string;
  label?: string;
  fieldType?: MockupFieldType;
  required: boolean;
  validation?: string;
  options: string[];
  columns: string[];
  action?: string;
  target?: string;
  origin?: MockupOrigin;
  requirements: string[];
  designs: string[];
}

export interface MockupScreen {
  id: string;
  title: string;
  requirements: string[];
  designs: string[];
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

/** Etiquetas legibles para los componentes. */
export const MOCKUP_COMPONENT_LABELS: Record<MockupComponentKind, string> = {
  text: "Texto",
  field: "Campo",
  selector: "Selector",
  button: "Botón",
  table: "Tabla",
};

/** Etiquetas legibles para los tipos de campo visual. */
export const MOCKUP_FIELD_TYPE_LABELS: Record<MockupFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  boolean: "Sí/no",
};

/** Etiquetas legibles para el origen declarado del dato. */
export const MOCKUP_ORIGIN_LABELS: Record<MockupOrigin, string> = {
  persisted: "Guardado",
  calculated: "Calculado",
  temporary: "Temporal",
  external: "Externo",
  undefined: "Sin definir",
};

/** Crear/guardar sin fuentes declaradas pero con referencias citadas. */
export const MOCKUP_NO_SOURCES = "mockup_no_sources";

/** Fuentes declaradas obsoletas al guardar. */
export const MOCKUP_STALE_SOURCES = "mockup_stale_sources";

/** Fuente declarada inexistente al guardar. */
export const MOCKUP_SOURCE_MISSING = "mockup_source_missing";

/** Contenido que no es un mockup válido. */
export const MOCKUP_INVALID = "mockup_invalid";

/** El artefacto no es un mockup. */
export const NOT_A_MOCKUP = "not_a_mockup";
