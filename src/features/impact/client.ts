// Adaptador Tauri para la consulta de impacto. Solo lectura: el análisis
// vive en `ruth-core` y aquí únicamente se invoca el comando.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type { ImpactReportDto } from "./types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "El mapa de impacto requiere ejecutar Ruth IDE como escritorio (Tauri).",
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
