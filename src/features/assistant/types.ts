// Tipos del panel Asistente Meta: acciones explícitas e historial.
export type AssistantAction = "requirements" | "design" | "update";

export const ASSISTANT_ACTIONS: { id: AssistantAction; label: string; hint: string }[] = [
  {
    id: "requirements",
    label: "Proponer requisitos",
    hint: "Describe el módulo; Meta propone requisitos y preguntas.",
  },
  {
    id: "design",
    label: "Generar flujo o ER",
    hint: "Desde requisitos y mockups guardados, marcando fuentes.",
  },
  {
    id: "update",
    label: "Proponer actualización",
    hint: "Ajustar un diseño afectado según el impacto vigente.",
  },
];

/** Entrada de historial: solicitud + resultado, solo lectura. */
export interface AssistantHistoryEntry {
  id: string;
  kind: "requirements" | "design" | "update";
  title: string;
  model: string;
  tokens: string;
  createdAt: string;
  stale: boolean;
  openCount: number;
}

/** Historial acotado: las últimas N, las demás siguen en su vista. */
export const ASSISTANT_HISTORY_LIMIT = 8;
