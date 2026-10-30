// NestJS facts: routes, repository calls and global pipeline.
// Tests read `symbols[0].flow` and `result.pipeline` through
// `analyzeTsFiles`.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";
import type { StructureInput, SymbolFlowFacts } from "./structureTypes";

function input(content: string): StructureInput {
  return { rootId: "root-1", rel: "f.ts", content, hash: "h:f.ts" };
}

function analyze(content: string) {
  return analyzeTsFiles([input(content)]);
}

function flowOf(content: string): SymbolFlowFacts {
  return analyze(content).symbols[0].flow!;
}

const CTRL = `@UseGuards(JwtGuard)
@Controller('esquema-columnas')
export class C {
  constructor(private readonly service: S) {}
  @Public()
  @UseInterceptors(LogInterceptor)
  @Post('bulk')
  createBulk(@Body() dtos: CreateDto[]) { return this.service.createBulk(dtos); }
  @Get()
  all() {}
}`;

describe("collectNestFacts", () => {
  it("joins controller and method paths with decorators", () => {
    const routes = flowOf(CTRL).routes;
    expect(routes[0]).toMatchObject({
      member: "createBulk",
      verb: "POST",
      path: "/esquema-columnas/bulk",
      bodyType: "CreateDto[]",
      decorators: ["Public"],
      guards: ["JwtGuard"],
      interceptors: ["LogInterceptor"],
    });
    expect(routes[1]).toMatchObject({ member: "all", verb: "GET", path: "/esquema-columnas" });
  });

  it("links repository calls to their entity", () => {
    const flow = flowOf(`export class S {
  constructor(@InjectRepository(Carga) private repo: Repository<Carga>) {}
  save(d: D) { return this.repo.save(d); }
}`);
    expect(flow.injections[0]).toMatchObject({ field: "repo", typeName: "Carga", via: "repository" });
    expect(flow.repositoryCalls[0]).toMatchObject({ member: "save", entity: "Carga", method: "save" });
    expect(flow.calls).toEqual([]);
  });

  it("reads global guards and interceptors", () => {
    const result = analyze(`@Module({ providers: [
  { provide: APP_GUARD, useClass: JwtGuard },
  { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
] })
export class M {}`);
    expect(result.pipeline?.map((p) => [p.scope, p.names])).toEqual([
      ["global-guard", ["JwtGuard"]],
      ["global-interceptor", ["MetricsInterceptor"]],
    ]);
  });

  it("reads useGlobal calls in bootstrap code", () => {
    const result = analyze(`async function boot(app: App) {
  app.useGlobalGuards(new AGuard());
  app.useGlobalInterceptors(new BInterceptor());
}`);
    expect(result.pipeline?.map((p) => p.names[0])).toEqual(["AGuard", "BInterceptor"]);
  });

  it("keeps a non-literal route path honest", () => {
    const flow = flowOf(`@Controller(PREFIX) export class C { @Get('x') a() {} }`);
    expect(flow.routes[0].path).toBe("/${...}/x");
  });
});
