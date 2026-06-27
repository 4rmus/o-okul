import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { GlobalSearchResultRecord } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodQuery } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SearchService } from "./search.service.js";

const searchQuerySchema = z.object({
  limit: optionalTrimmedString,
  q: requiredTrimmedString,
  types: optionalTrimmedString,
}).strict();

type SearchQuery = z.infer<typeof searchQuerySchema>;

@Controller("search")
@UseGuards(RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles("TEACHER")
  @RequireCapability("search:read")
  search(@Query(zodQuery(searchQuerySchema)) query: SearchQuery): Promise<GlobalSearchResultRecord[]> {
    return this.searchService.search(getRequestContext(), query);
  }
}
