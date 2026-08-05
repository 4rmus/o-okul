export type NotificationChannel = "EMAIL" | "PUSH";

export interface NotificationMessage {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
  idempotencyKey?: string;
}

export interface NotificationSendResult {
  channel: NotificationChannel;
  to: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  errorCode?: string;
}

export interface NotificationAdapter {
  sendBatch(messages: NotificationMessage[]): Promise<NotificationSendResult[]>;
}

export interface NotificationAdapterEnvironment {
  NODE_ENV?: string;
  NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION?: string;
  NOTIFICATION_HTTP_BEARER_TOKEN?: string;
  NOTIFICATION_HTTP_ENDPOINT?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  NOTIFICATION_PROVIDER?: string;
  NOTIFICATION_REPLY_TO_EMAIL?: string;
}

export function createNotificationAdapterFromEnv(env: NotificationAdapterEnvironment): NotificationAdapter {
  const provider = env.NOTIFICATION_PROVIDER ?? "noop";
  if (provider === "http") {
    return createHttpNotificationAdapterFromEnv(env);
  }
  if (provider !== "noop") {
    throw new Error("NOTIFICATION_PROVIDER_UNSUPPORTED");
  }
  if (env.NODE_ENV === "production" && env.NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION !== "true") {
    throw new Error("NOTIFICATION_PROVIDER_REQUIRED");
  }
  return createNoopNotificationAdapter();
}

export function createNoopNotificationAdapter(): NotificationAdapter {
  return {
    async sendBatch(messages) {
      return messages.map((message, index) => ({
        channel: message.channel,
        to: message.to,
        status: "sent",
        providerMessageId: `noop-${index + 1}`,
      }));
    },
  };
}

export interface HttpNotificationAdapterOptions {
  bearerToken?: string;
  endpoint: string;
  fetch?: NotificationFetch;
  fromEmail: string;
  replyToEmail: string;
}

interface NotificationFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type NotificationFetch = (
  input: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  },
) => Promise<NotificationFetchResponse>;

interface HttpNotificationResult {
  channel?: NotificationChannel;
  errorCode?: string;
  providerMessageId?: string;
  status?: "sent" | "failed";
  to?: string;
}

interface HttpNotificationResponse {
  errorCode?: string;
  results?: HttpNotificationResult[];
}

export class HttpNotificationAdapter implements NotificationAdapter {
  private readonly bearerToken?: string;
  private readonly endpoint: string;
  private readonly fetchImpl: NotificationFetch;
  private readonly fromEmail: string;
  private readonly replyToEmail: string;

  constructor(options: HttpNotificationAdapterOptions) {
    this.endpoint = requiredConfig(options.endpoint, "NOTIFICATION_HTTP_ENDPOINT_MISSING");
    this.fromEmail = requiredEmail(options.fromEmail, "NOTIFICATION_FROM_EMAIL_MISSING", "NOTIFICATION_FROM_EMAIL_INVALID");
    this.replyToEmail = requiredEmail(options.replyToEmail, "NOTIFICATION_REPLY_TO_EMAIL_MISSING", "NOTIFICATION_REPLY_TO_EMAIL_INVALID");
    this.bearerToken = optionalConfig(options.bearerToken);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async sendBatch(messages: NotificationMessage[]): Promise<NotificationSendResult[]> {
    if (messages.length === 0) {
      return [];
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messages: messages.map((message) => ({
          channel: message.channel,
          to: message.to,
          ...(message.channel === "EMAIL" ? { from: this.fromEmail, replyTo: this.replyToEmail } : {}),
          ...(message.subject ? { subject: message.subject } : {}),
          body: message.body,
          ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
        })),
      }),
    });

    const responseBody = parseHttpNotificationResponse(await response.text());
    if (!response.ok) {
      const errorCode = responseBody.errorCode ?? `NOTIFICATION_HTTP_${response.status}`;
      return messages.map((message) => failedResult(message, errorCode));
    }

    if (!Array.isArray(responseBody.results) || responseBody.results.length !== messages.length) {
      throw new Error("NOTIFICATION_HTTP_RESPONSE_INVALID");
    }

    return responseBody.results.map((result, index) => mapHttpResult(messages[index]!, result));
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.bearerToken ? { authorization: `Bearer ${this.bearerToken}` } : {}),
    };
  }
}

export function createHttpNotificationAdapterFromEnv(env: NotificationAdapterEnvironment): HttpNotificationAdapter {
  return new HttpNotificationAdapter({
    bearerToken: env.NOTIFICATION_HTTP_BEARER_TOKEN,
    endpoint: env.NOTIFICATION_HTTP_ENDPOINT ?? "",
    fromEmail: env.NOTIFICATION_FROM_EMAIL ?? "",
    replyToEmail: env.NOTIFICATION_REPLY_TO_EMAIL ?? "",
  });
}

function mapHttpResult(message: NotificationMessage, result: HttpNotificationResult): NotificationSendResult {
  if (result.status !== "sent" && result.status !== "failed") {
    throw new Error("NOTIFICATION_HTTP_RESPONSE_INVALID");
  }

  return {
    channel: result.channel ?? message.channel,
    to: result.to ?? message.to,
    status: result.status,
    providerMessageId: result.providerMessageId,
    errorCode: result.status === "failed" ? (result.errorCode ?? "NOTIFICATION_PROVIDER_FAILED") : result.errorCode,
  };
}

function failedResult(message: NotificationMessage, errorCode: string): NotificationSendResult {
  return {
    channel: message.channel,
    to: message.to,
    status: "failed",
    errorCode,
  };
}

function parseHttpNotificationResponse(text: string): HttpNotificationResponse {
  try {
    return JSON.parse(text) as HttpNotificationResponse;
  } catch {
    throw new Error("NOTIFICATION_HTTP_RESPONSE_INVALID");
  }
}

function requiredConfig(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(errorCode);
  }
  return trimmed;
}

function optionalConfig(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function requiredEmail(value: string | undefined, missingCode: string, invalidCode: string): string {
  const email = requiredConfig(value, missingCode);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(invalidCode);
  }
  return email;
}
