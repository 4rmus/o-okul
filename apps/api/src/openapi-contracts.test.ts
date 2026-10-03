import type { OpenAPIObject } from "@nestjs/swagger";
import { describe, expect, it } from "vitest";
import { applyOpenApiContracts } from "./openapi-contracts.js";

describe("applyOpenApiContracts", () => {
  it("fails generation when a contract has no matching route (PO-5)", () => {
    const document = { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIObject;
    expect(() => applyOpenApiContracts(document)).toThrow(/^OPENAPI_CONTRACT_ROUTE_MISSING: /);
  });
});
