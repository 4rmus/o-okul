import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { applyOpenApiContracts } from "./openapi-contracts.js";

export const openApiUiPath = "docs";

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Uzman Hocam API")
    .setDescription("Uzman Hocam multi-tenant SaaS REST API")
    .setVersion(process.env.npm_package_version ?? "0.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token",
      },
      "access-token",
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, "")}_${methodKey}`,
  });
  return applyOpenApiContracts(document);
}

export function mountOpenApi(app: INestApplication, env = process.env): void {
  if (!isOpenApiUiEnabled(env)) return;

  SwaggerModule.setup(openApiUiPath, app, createOpenApiDocument(app), {
    swaggerOptions: {
      persistAuthorization: false,
    },
  });
}

export function isOpenApiUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENAPI_UI_ENABLED === "true" && env.NODE_ENV !== "production";
}
