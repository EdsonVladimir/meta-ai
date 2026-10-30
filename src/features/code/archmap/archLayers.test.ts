// Layer taxonomy: suffix, directory and entry-point rules plus decorator
// refinement. Real paths from the ACME pilot double as regression cases.
import { describe, expect, it } from "vitest";
import {
  ARCH_LAYERS,
  classifyFile,
  classifySymbol,
  refineByDecorators,
  type ArchLayer,
} from "./archLayers";

function layerOf(rel: string): ArchLayer {
  return classifyFile(rel).layer;
}

describe("archLayers order", () => {
  it("lists every layer exactly once in call order", () => {
    expect(ARCH_LAYERS.map((l) => l.id)).toEqual([
      "ui",
      "controllers",
      "state",
      "services",
      "contracts",
      "composition",
      "crosscutting",
      "unassigned",
    ]);
    expect(ARCH_LAYERS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("classifyFile", () => {
  it("classifies NestJS backend conventions", () => {
    expect(layerOf("src/app.controller.ts")).toBe("controllers");
    expect(layerOf("src/observability/health.controller.ts")).toBe("controllers");
    expect(layerOf("src/modules/contrato-datos/contrato-datos.service.ts")).toBe("services");
    expect(layerOf("src/app.module.ts")).toBe("composition");
    expect(layerOf("src/modules/contrato-datos/dto/contrato-datos.dto.ts")).toBe("contracts");
    expect(layerOf("src/modules/contrato-datos/entities/campo-contrato.entity.ts")).toBe(
      "contracts",
    );
    expect(layerOf("src/main.ts")).toBe("composition");
    expect(layerOf("src/tracing.ts")).toBe("unassigned");
  });

  it("classifies Angular frontend conventions", () => {
    expect(layerOf("src/app/app.component.ts")).toBe("ui");
    expect(layerOf("src/app/modules/sales/pages/list.page.ts")).toBe("ui");
    expect(layerOf("src/app/core/auth.service.ts")).toBe("services");
    expect(layerOf("src/app/core/auth.guard.ts")).toBe("crosscutting");
    expect(layerOf("src/app/core/token.interceptor.ts")).toBe("crosscutting");
    expect(layerOf("src/app/app.routes.ts")).toBe("composition");
    expect(layerOf("src/app/models/user.model.ts")).toBe("contracts");
    expect(layerOf("src/app/cart/cart.store.ts")).toBe("state");
  });

  it("prefers suffix over directory", () => {
    // A DTO living in shared/ is still a contract, not cross-cutting.
    expect(layerOf("src/shared/user.dto.ts")).toBe("contracts");
    expect(layerOf("src/shared/format.ts")).toBe("crosscutting");
  });

  it("classifies utils, helpers and environments as cross-cutting", () => {
    expect(layerOf("src/app/core/auth/token-expirado.util.ts")).toBe("crosscutting");
    expect(layerOf("src/environments/environment.prod.ts")).toBe("crosscutting");
    expect(layerOf("src/dates.helper.ts")).toBe("crosscutting");
  });

  it("matches directories and wiring files", () => {
    expect(layerOf("src/services/billing.ts")).toBe("services");
    expect(layerOf("src/common/dates.ts")).toBe("crosscutting");
    expect(layerOf("src/config/env.ts")).toBe("crosscutting");
    expect(layerOf("src/server.ts")).toBe("composition");
    expect(layerOf("src/modules/sales/index.ts")).toBe("composition");
  });

  it("classifies enums and constants as contracts", () => {
    expect(layerOf("src/modules/ingesta/enums.ts")).toBe("contracts");
    expect(layerOf("src/geojson.constants.ts")).toBe("contracts");
    expect(layerOf("src/tipo.enum.ts")).toBe("contracts");
  });

  it("leaves tests and unknowns unassigned with a reason", () => {
    const spec = classifyFile("src/app.service.spec.ts");
    expect(spec.layer).toBe("unassigned");
    expect(spec.reason).toContain("test");
    const unknown = classifyFile("src/tracing.ts");
    expect(unknown).toEqual({ layer: "unassigned", reason: "no rule matched" });
  });

  it("matching is case-insensitive", () => {
    expect(layerOf("src/Users/User.DTO.ts")).toBe("contracts");
    expect(layerOf("SRC/COMMON/Dates.TS")).toBe("crosscutting");
  });
});

describe("refineByDecorators", () => {
  it("keeps the path verdict when decorators agree or are unknown", () => {
    const base = classifyFile("src/app.controller.ts");
    const same = refineByDecorators(base, ["Controller"]);
    expect(same.layer).toBe("controllers");
    expect(same.reason).toContain("agrees");
    expect(refineByDecorators(base, ["Get"])).toEqual(base);
    expect(refineByDecorators(base, [])).toEqual(base);
  });

  it("lets a known decorator override an odd path", () => {
    const base = classifyFile("src/tracing.ts");
    const refined = refineByDecorators(base, ["Injectable"]);
    expect(refined.layer).toBe("services");
    expect(refined.reason).toContain("@Injectable");
    expect(refined.reason).toContain("overrides");
  });

  it("uses the first known decorator", () => {
    const base = classifyFile("src/mixed.ts");
    expect(refineByDecorators(base, ["Get", "Entity"]).layer).toBe("contracts");
  });
});

describe("classifySymbol", () => {
  it("lets the symbol's own decorator win over an odd file", () => {
    const verdict = classifySymbol("src/tracing.ts", {
      kind: "class",
      name: "Tracer",
      decorators: ["Injectable"],
    });
    expect(verdict.layer).toBe("services");
    expect(verdict.reason).toContain("@Injectable");
  });

  it("keeps a DTO interface a contract beside an Injectable class", () => {
    const verdict = classifySymbol("src/shop.service.ts", {
      kind: "interface",
      name: "OrderDto",
      decorators: [],
    });
    expect(verdict.layer).toBe("contracts");
    // The file's other symbols never leak into this verdict.
    expect(verdict.reason).not.toContain("Injectable");
  });

  it("classifies by name without turning every class into a service", () => {
    const service = classifySymbol("src/misc.ts", {
      kind: "class",
      name: "BillingService",
      decorators: [],
    });
    expect(service.layer).toBe("services");
    expect(service.reason).toContain("Service");
    const plain = classifySymbol("src/misc.ts", {
      kind: "class",
      name: "Calculator",
      decorators: [],
    });
    expect(plain).toEqual({ layer: "unassigned", reason: "no rule matched" });
  });

  it("falls back to the file path with an explicit reason", () => {
    const verdict = classifySymbol("src/services/billing.ts", {
      kind: "class",
      name: "Billing",
      decorators: [],
    });
    expect(verdict.layer).toBe("services");
    expect(verdict.reason).toContain("file path");
    const fn = classifySymbol("src/utils/format.ts", {
      kind: "function",
      name: "format",
      decorators: [],
    });
    expect(fn.layer).toBe("crosscutting");
  });

  it("sends components to UI and homeless functions nowhere", () => {
    expect(
      classifySymbol("src/app.tsx", { kind: "component", name: "Shop", decorators: [] }).layer,
    ).toBe("ui");
    expect(
      classifySymbol("src/misc.ts", { kind: "function", name: "helper", decorators: [] }),
    ).toEqual({ layer: "unassigned", reason: "no rule matched" });
  });
});
