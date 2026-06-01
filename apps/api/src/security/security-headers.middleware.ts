import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const headers = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }
    next();
  }
}
