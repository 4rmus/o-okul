import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { map, Observable } from "rxjs";
import { readListMeta } from "../listing/list-query.js";

export interface ListResponse<TItem> {
  data: TItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ItemResponse<TItem> {
  data: TItem;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.path === "/health" || request.path === "/health/ready") {
      return next.handle();
    }

    return next.handle().pipe(map((body: unknown) => envelope(body)));
  }
}

function envelope(body: unknown): unknown {
  if (body === undefined) {
    return body;
  }

  if (Array.isArray(body)) {
    const meta = readListMeta(body) ?? {
      total: body.length,
      page: 1,
      limit: body.length,
      totalPages: body.length === 0 ? 0 : 1,
    };
    return {
      data: body,
      meta,
    } satisfies ListResponse<unknown>;
  }

  return { data: body } satisfies ItemResponse<unknown>;
}
