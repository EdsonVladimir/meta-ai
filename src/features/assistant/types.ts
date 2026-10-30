// Meta Assistant panel types: explicit actions and history.
export type AssistantAction = "requirements" | "design" | "update";

export const ASSISTANT_ACTIONS: { id: AssistantAction; label: string; hint: string }[] = [
  {
    id: "requirements",
    label: "Propose requirements",
    hint: "Describe the module; Meta proposes requirements and questions.",
  },
  {
    id: "design",
    label: "Generate flow or ER",
    hint: "From saved requirements and mockups, marking sources.",
  },
  {
    id: "update",
    label: "Propose update",
    hint: "Adjust an affected design per the live impact.",
  },
];

/** History entry: request + result, read-only. */
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

/** Bounded history: the latest N, the rest stay in their view. */
export const ASSISTANT_HISTORY_LIMIT = 8;
