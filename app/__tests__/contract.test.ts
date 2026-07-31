/**
 * Contract parity test (TypeScript side).
 *
 * Proves the TS `Command`/`Snapshot` types serialise to JSON that satisfies the
 * shared schema in `contracts/commands.schema.json`, and that the shared golden
 * fixtures decode as expected. The Rust side asserts the same fixtures in
 * `core/src/ffi.rs`, so both ends of the boundary are pinned to one schema.
 */

import Ajv, { type ValidateFunction } from "ajv";
import { describe, it, expect } from "vitest";

import schema from "../../contracts/commands.schema.json";
import fixtures from "../../contracts/fixtures.json";
import type { Command, Snapshot, CoreResponse } from "../src/contract/types";
import { isError } from "../src/contract/types";

const ajv = new Ajv();
ajv.addSchema(schema, "protocol");
const validateCommand = ajv.compile({ $ref: "protocol#/definitions/Command" });
const validateSnapshot = ajv.compile({ $ref: "protocol#/definitions/Snapshot" });
const validateResponse = ajv.compile({ $ref: "protocol#/definitions/Response" });

function assertValid(fn: ValidateFunction, value: unknown, label: string) {
  const ok = fn(value);
  if (!ok) {
    throw new Error(`${label} failed schema: ${ajv.errorsText(fn.errors)}`);
  }
  expect(ok).toBe(true);
}

describe("Command ⟷ schema", () => {
  const commands: Command[] = [
    { type: "Play" },
    { type: "Pause" },
    { type: "Next" },
    { type: "Prev" },
    { type: "GetState" },
    { type: "SeekUnit", unit: 3 },
    { type: "WordBoundary", utf16Offset: 6 },
  ];

  it.each(commands)("every TS command validates: %j", (command) => {
    // Round-trip through JSON exactly as the native module will.
    const wire = JSON.parse(JSON.stringify(command));
    assertValid(validateCommand, wire, "command");
  });

  it("rejects an unknown command type", () => {
    expect(validateCommand({ type: "Explode" })).toBe(false);
  });

  it("rejects SeekUnit without a unit", () => {
    expect(validateCommand({ type: "SeekUnit" })).toBe(false);
  });
});

describe("Snapshot ⟷ schema", () => {
  it("a fully-populated snapshot validates", () => {
    const snap: Snapshot = {
      status: "playing",
      unit: 0,
      unitCount: 2,
      token: 1,
      tokenCount: 2,
      utterance: "Hello world.",
      highlight: { start: 6, end: 11 },
    };
    assertValid(validateSnapshot, snap, "snapshot");
  });

  it("a null highlight validates", () => {
    const snap: Snapshot = {
      status: "finished",
      unit: 1,
      unitCount: 2,
      token: 0,
      tokenCount: 0,
      utterance: "",
      highlight: null,
    };
    assertValid(validateSnapshot, snap, "snapshot");
  });
});

describe("shared golden fixtures", () => {
  it("the play fixture matches the schema and expected shape", () => {
    const playCase = fixtures.cases.find((c) => c.name === "play_lights_first_word")!;
    assertValid(validateResponse, playCase.expect, "response");
    const snap = playCase.expect as Snapshot;
    expect(snap.utterance).toBe("Hello world.");
    expect(snap.highlight).toEqual({ start: 0, end: 5 });
  });

  it("the error fixture is an error envelope, not a snapshot", () => {
    const errorCase = fixtures.cases.find((c) => c.name === "seek_out_of_range_errors")!;
    const response: CoreResponse = {
      error: { code: errorCase.expect_error_code as never, message: "…" },
    };
    expect(isError(response)).toBe(true);
    assertValid(validateResponse, response, "response");
  });
});
