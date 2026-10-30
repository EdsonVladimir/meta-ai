// Tauri adapter for the impact query. Read-only: analysis lives in
// `ruth-core` and only the command is invoked here.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type { ImpactReportDto } from "./types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "The impact map requires running Ruth IDE as a desktop app (Tauri).",
    } satisfies CoreApiError;
  }
}

export async function impactReport(input: {
  projectId: string;
  artifactId: string;
  fromVersionId?: string | null;
}): Promise<ImpactReportDto> {
  ensureTauri();
  try {
    return await invoke<ImpactReportDto>("core_impact_report", { input });
  } catch (raw) {
    throw normalizeCoreError(raw);
  }
}
