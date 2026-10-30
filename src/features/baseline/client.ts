// Tauri adapter for baselines and export. Rules live in Rust; here only
// commands are invoked and the native save dialog opens. The frontend
// never writes to disk directly.
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
      message: `${action} requires running Ruth IDE as a desktop app (Tauri).`,
    } satisfies CoreApiError;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauri("Baselines");
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
 * Native dialog to pick where to save the ZIP. Returns the path, or
 * `null` when the user cancels (cancelling writes nothing and reports
 * no success).
 */
export async function pickZipDestination(defaultName: string): Promise<string | null> {
  ensureTauri("Saving the ZIP");
  try {
    const chosen = await save({
      title: "Save delivery as ZIP",
      defaultPath: defaultName,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    return chosen;
  } catch (raw) {
    throw normalizeCoreError(raw);
  }
}
