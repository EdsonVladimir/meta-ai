// Guardián del lenguaje honesto en entregas de trabajo: una entrega borrador
// jamás se presenta como «coherente» ni «verificada»; muestra pendientes,
// revisiones opcionales y fuentes obsoletas. Este test lee la fuente del
// panel y falla si aparecen afirmaciones prohibidas.
import { describe, expect, it } from "vitest";
import sourceRaw from "./DeliveryDialog.tsx?raw";

// Solo el texto visible: los comentarios pueden nombrar la regla sin violarla.
const source = sourceRaw
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|\s)\/\/.*$/gm, " ")
  .toLowerCase();

describe("lenguaje honesto de entregas de trabajo", () => {
  it("no afirma coherencia ni verificación", () => {
    for (const forbidden of ["coherente", "verificado", "verificada"]) {
      expect(source, `palabra prohibida: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("identifica el borrador y sus pendientes", () => {
    for (const required of ["borrador", "sin revisar", "obsoletas"]) {
      expect(source, `texto requerido: ${required}`).toContain(required);
    }
  });

  it("aclara que los hashes no son firma digital", () => {
    expect(source).toContain("no son una firma digital");
  });
});
