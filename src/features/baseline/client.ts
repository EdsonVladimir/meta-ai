// Adaptador Tauri para baselines y exportación. Las reglas viven en Rust;
// aquí solo se invocan comandos y se abre el diálogo nativo de guardado.
// El frontend nunca escribe en disco directamente.
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError } from "../requirements/types";
import type { CoreApiError } from "../requirements/types";
import type {
  BaselineDto,
  BaselinePreviewDto,
  BaselineSummaryDto,
  DeliveryDto,
  DeliveryExportPreviewDto,
  DeliveryExportSaveDto,
  DeliveryPreviewDto,
  DeliverySummaryDto,
  ExportPreviewDto,
  ExportSaveDto,
} from "./types";

function ensureTauri(action: string): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: `${action} requiere ejecutar Ruth IDE como escritorio (Tauri).`,
    } satisfies CoreApiError;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauri("Las baselines");
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeCoreError(raw);
  }
}

export function prepareBaseline(input: {
  projectId: string;
  scopeModuleId: string;
  artifactIds: string[];
}): Promise<BaselinePreviewDto> {
  return call("core_prepare_baseline", { input });
}

export function createBaseline(input: {
  projectId: string;
  name: string;
  description?: string | null;
  scopeModuleId?: string | null;
  entries: Array<{ artifactId: string; versionId: string }>;
}): Promise<BaselineDto> {
  return call("core_create_baseline", { input });
}

export function getBaseline(
  projectId: string,
  baselineId: string,
): Promise<BaselineDto> {
  return call("core_get_baseline", { input: { projectId, baselineId } });
}

export function listBaselines(projectId: string): Promise<BaselineSummaryDto[]> {
  return call("core_list_baselines", { input: { projectId } });
}

export function exportPreview(
  projectId: string,
  baselineId: string,
): Promise<ExportPreviewDto> {
  return call("core_export_preview", { input: { projectId, baselineId } });
}

export function exportSave(input: {
  projectId: string;
  baselineId: string;
  destPath: string;
  overwrite: boolean;
}): Promise<ExportSaveDto> {
  return call("core_export_save", { input });
}

export function prepareDelivery(input: {
  projectId: string;
  scopeModuleId: string;
  artifactIds: string[];
}): Promise<DeliveryPreviewDto> {
  return call("core_prepare_delivery", { input });
}

export function createDelivery(input: {
  projectId: string;
  name: string;
  description?: string | null;
  scopeModuleId?: string | null;
  entries: Array<{ artifactId: string; versionId: string }>;
}): Promise<DeliveryDto> {
  return call("core_create_delivery", { input });
}

export function getDelivery(projectId: string, deliveryId: string): Promise<DeliveryDto> {
  return call("core_get_delivery", { input: { projectId, deliveryId } });
}

export function listDeliveries(projectId: string): Promise<DeliverySummaryDto[]> {
  return call("core_list_deliveries", { input: { projectId } });
}

export function exportDeliveryPreview(
  projectId: string,
  deliveryId: string,
): Promise<DeliveryExportPreviewDto> {
  return call("core_export_delivery_preview", { input: { projectId, deliveryId } });
}

export function exportDeliverySave(input: {
  projectId: string;
  deliveryId: string;
  destPath: string;
  overwrite: boolean;
}): Promise<DeliveryExportSaveDto> {
  return call("core_export_delivery_save", { input });
}

/**
 * Diálogo nativo para elegir dónde guardar el ZIP. Devuelve la ruta o
 * `null` si el usuario cancela (cancelar no escribe ni informa éxito).
 */
export async function pickZipDestination(defaultName: string): Promise<string | null> {
  ensureTauri("Guardar el ZIP");
  try {
    const chosen = await save({
      title: "Guardar entrega como ZIP",
      defaultPath: defaultName,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    return chosen;
  } catch (raw) {
    throw normalizeCoreError(raw);
  }
}
