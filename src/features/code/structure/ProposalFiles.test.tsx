// @vitest-environment jsdom
// Accept all: one click writes every pending file, in order, and stops
// at the first failure.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CODE_EDITOR_PREFS } from "../editorPrefs";
import type { CodeGenerationDto, CodeProposalFileDto } from "../types";
import { ProposalFiles, type ProposalFilesApi } from "./ProposalFiles";

afterEach(() => cleanup());

function fileDto(pos: number, state: CodeProposalFileDto["state"] = "pending"): CodeProposalFileDto {
  return {
    pos,
    rootId: "r",
    rel: `f${pos}.ts`,
    operation: "create",
    state,
    decidedAt: null,
    content: "x",
    expectedFingerprint: null,
  };
}

function generationDto(files: CodeProposalFileDto[], stale = false): CodeGenerationDto {
  return { id: "cgen-1", files, stale, staleReason: null } as unknown as CodeGenerationDto;
}

function setup(generation: CodeGenerationDto, failAt: number | null = null) {
  const accepted = new Set<number>();
  const acceptFile = vi.fn(async (_id: string, pos: number) => {
    if (pos === failAt) throw { kind: "code_conflict", message: "Already exists." };
    accepted.add(pos);
    return {
      generation: generationDto(
        generation.files.map((file) =>
          accepted.has(file.pos) ? { ...file, state: "accepted" as const } : file,
        ),
      ),
      alreadyAccepted: false,
      fingerprint: "h",
      size: 1,
    };
  });
  const api = { acceptFile, discardFile: vi.fn(), readFile: vi.fn() };
  const onChange = vi.fn();
  const onAccepted = vi.fn();
  render(
    <ProposalFiles
      generation={generation}
      rootNames={{}}
      api={api as unknown as ProposalFilesApi}
      prefs={DEFAULT_CODE_EDITOR_PREFS}
      onChange={onChange}
      onAccepted={onAccepted}
    />,
  );
  return { acceptFile, onChange, onAccepted };
}

describe("Accept all", () => {
  it("writes every pending file in order, skipping decided ones", async () => {
    const { acceptFile, onAccepted, onChange } = setup(
      generationDto([fileDto(0), fileDto(1, "discarded"), fileDto(2), fileDto(3)]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept all (3)" }));
    await screen.findByText("3 files written to disk.");
    expect(acceptFile.mock.calls.map((call) => call[1])).toEqual([0, 2, 3]);
    expect(onAccepted.mock.calls.map((call) => call[1])).toEqual(["f0.ts", "f2.ts", "f3.ts"]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("stops at the first failure and says what stayed pending", async () => {
    const { acceptFile } = setup(generationDto([fileDto(0), fileDto(1), fileDto(2)]), 1);
    fireEvent.click(screen.getByRole("button", { name: "Accept all (3)" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain('Stopped at "f1.ts"');
    expect(alert.textContent).toContain("1 of 3 accepted");
    await waitFor(() => expect(acceptFile).toHaveBeenCalledTimes(2));
  });

  it("is absent for a single file and blocked on a stale proposal", () => {
    setup(generationDto([fileDto(0)]));
    expect(screen.queryByRole("button", { name: /Accept all/ })).toBeNull();
    cleanup();
    setup(generationDto([fileDto(0), fileDto(1)], true));
    expect(screen.getByRole("button", { name: "Accept all (2)" })).toHaveProperty("disabled", true);
  });
});

describe("View diff", () => {
  it("never shows a failed read as an empty file", async () => {
    const generation = generationDto([{ ...fileDto(0), operation: "modify" }]);
    const readFile = vi.fn(async () => {
      throw { kind: "code_io", message: "Denied." };
    });
    render(
      <ProposalFiles
        generation={generation}
        rootNames={{}}
        api={{ acceptFile: vi.fn(), discardFile: vi.fn(), readFile } as unknown as ProposalFilesApi}
        prefs={DEFAULT_CODE_EDITOR_PREFS}
        onChange={() => {}}
        onAccepted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View diff" }));
    expect(await screen.findByText(/could not be read, so no comparison/)).toBeTruthy();
  });
});

