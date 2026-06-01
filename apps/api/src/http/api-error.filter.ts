import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json(toErrorBody(exception, status));
  }
}

function toErrorBody(exception: unknown, status: number): ErrorBody {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (hasErrorEnvelope(response)) {
      return response;
    }

    const code = readErrorCode(response, exception);
    return {
      error: {
        code,
        message: messageForStatus(status),
      },
    };
  }

  return {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Beklenmeyen bir hata oluştu.",
    },
  };
}

function hasErrorEnvelope(value: unknown): value is ErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === "object" && "code" in error && "message" in error);
}

function readErrorCode(response: string | object, exception: HttpException): string {
  if (typeof response === "string") return response;
  if ("message" in response && typeof response.message === "string") return response.message;
  if ("error" in response && typeof response.error === "string") return response.error;
  return exception.name || "HTTP_ERROR";
}

function messageForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "İstek geçersiz.";
    case HttpStatus.UNAUTHORIZED:
      return "Oturum gerekli.";
    case HttpStatus.FORBIDDEN:
      return "Erişim izni yok.";
    case HttpStatus.NOT_FOUND:
      return "Kayıt bulunamadı.";
    case HttpStatus.CONFLICT:
      return "Çakışma oluştu.";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Çok fazla deneme yapıldı.";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "Servis hazır değil.";
    default:
      return "İstek işlenemedi.";
  }
}
