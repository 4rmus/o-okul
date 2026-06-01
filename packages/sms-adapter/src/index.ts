export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSegmentEstimate {
  encoding: "GSM_7" | "UNICODE";
  characterCount: number;
  messageUnits: number;
  segments: number;
  singleSegmentLimit: number;
  multipartSegmentLimit: number;
}

export interface SmsSendResult {
  to: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  errorCode?: string;
  segmentEstimate?: SmsSegmentEstimate;
}

export interface SmsAdapter {
  sendBatch(messages: SmsMessage[]): Promise<SmsSendResult[]>;
}

export interface SmsAdapterEnvironment {
  NETGSM_APP_NAME?: string;
  NETGSM_ENDPOINT?: string;
  NETGSM_IYS_FILTER?: string;
  NETGSM_MSG_HEADER?: string;
  NETGSM_PASSWORD?: string;
  NETGSM_USERCODE?: string;
  NODE_ENV?: string;
  SMS_ALLOW_NOOP_IN_PRODUCTION?: string;
  SMS_PROVIDER?: string;
}

export function createSmsAdapterFromEnv(env: SmsAdapterEnvironment): SmsAdapter {
  const provider = env.SMS_PROVIDER ?? "noop";
  if (provider === "netgsm") {
    return createNetgsmSmsAdapterFromEnv(env);
  }
  if (provider !== "noop") {
    throw new Error("SMS_PROVIDER_UNSUPPORTED");
  }
  if (env.NODE_ENV === "production" && env.SMS_ALLOW_NOOP_IN_PRODUCTION !== "true") {
    throw new Error("SMS_PROVIDER_REQUIRED");
  }
  return createNoopSmsAdapter();
}

export function createNoopSmsAdapter(): SmsAdapter {
  return {
    async sendBatch(messages) {
      return messages.map((message, index) => ({
        to: message.to,
        status: "sent",
        providerMessageId: `noop-${index + 1}`,
        segmentEstimate: estimateSmsSegments(message.body),
      }));
    },
  };
}

export interface NetgsmSmsAdapterOptions {
  appName?: string;
  endpoint?: string;
  fetch?: SmsFetch;
  iysFilter?: string;
  msgHeader: string;
  password: string;
  usercode: string;
}

interface SmsFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type SmsFetch = (
  input: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  },
) => Promise<SmsFetchResponse>;

interface NetgsmSendResponse {
  code?: string | number;
  description?: string;
  jobid?: string;
}

export class NetgsmSmsAdapter implements SmsAdapter {
  private readonly appName?: string;
  private readonly endpoint: string;
  private readonly fetchImpl: SmsFetch;
  private readonly iysFilter: string;
  private readonly msgHeader: string;
  private readonly password: string;
  private readonly usercode: string;

  constructor(options: NetgsmSmsAdapterOptions) {
    this.usercode = requiredConfig(options.usercode, "NETGSM_USERCODE_MISSING");
    this.password = requiredConfig(options.password, "NETGSM_PASSWORD_MISSING");
    this.msgHeader = requiredConfig(options.msgHeader, "NETGSM_MSG_HEADER_MISSING");
    this.endpoint = options.endpoint?.trim() || "https://api.netgsm.com.tr/sms/rest/v2/send";
    this.iysFilter = options.iysFilter?.trim() || "0";
    this.appName = optionalConfig(options.appName);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async sendBatch(messages: SmsMessage[]): Promise<SmsSendResult[]> {
    if (messages.length === 0) {
      return [];
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${this.usercode}:${this.password}`)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        msgheader: this.msgHeader,
        messages: messages.map((message) => ({
          msg: message.body,
          no: message.to,
        })),
        encoding: "TR",
        iysfilter: this.iysFilter,
        ...(this.appName ? { appname: this.appName } : {}),
      }),
    });

    const responseText = await response.text();
    const result = parseNetgsmResponse(responseText);
    if (!response.ok) {
      return messages.map((message) => failedResult(message, `NETGSM_${result.code ?? `HTTP_${response.status}`}`));
    }

    if (String(result.code) !== "00") {
      return messages.map((message) => failedResult(message, `NETGSM_${result.code ?? "UNKNOWN"}`));
    }

    return messages.map((message) => ({
      to: message.to,
      status: "sent",
      providerMessageId: result.jobid,
      segmentEstimate: estimateSmsSegments(message.body),
    }));
  }
}

export function createNetgsmSmsAdapterFromEnv(env: SmsAdapterEnvironment): NetgsmSmsAdapter {
  return new NetgsmSmsAdapter({
    appName: env.NETGSM_APP_NAME,
    endpoint: env.NETGSM_ENDPOINT,
    iysFilter: env.NETGSM_IYS_FILTER,
    msgHeader: env.NETGSM_MSG_HEADER ?? "",
    password: env.NETGSM_PASSWORD ?? "",
    usercode: env.NETGSM_USERCODE ?? "",
  });
}

export function estimateSmsSegments(body: string): SmsSegmentEstimate {
  const characters = Array.from(body);
  const encoding = characters.every(isGsm7Character) ? "GSM_7" : "UNICODE";
  const singleSegmentLimit = encoding === "GSM_7" ? 160 : 70;
  const multipartSegmentLimit = encoding === "GSM_7" ? 153 : 67;
  const messageUnits = encoding === "GSM_7" ? countGsm7Units(characters) : characters.length;
  const segments = messageUnits === 0
    ? 0
    : messageUnits <= singleSegmentLimit
      ? 1
      : Math.ceil(messageUnits / multipartSegmentLimit);

  return {
    encoding,
    characterCount: characters.length,
    messageUnits,
    segments,
    singleSegmentLimit,
    multipartSegmentLimit,
  };
}

function failedResult(message: SmsMessage, errorCode: string): SmsSendResult {
  return {
    to: message.to,
    status: "failed",
    errorCode,
    segmentEstimate: estimateSmsSegments(message.body),
  };
}

function parseNetgsmResponse(text: string): NetgsmSendResponse {
  try {
    return JSON.parse(text) as NetgsmSendResponse;
  } catch {
    throw new Error("NETGSM_RESPONSE_INVALID");
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

const gsm7BasicCharacters = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);

const gsm7ExtensionCharacters = new Set("^{}\\[~]|€\f".split(""));

function isGsm7Character(character: string): boolean {
  return gsm7BasicCharacters.has(character) || gsm7ExtensionCharacters.has(character);
}

function countGsm7Units(characters: string[]): number {
  return characters.reduce(
    (total, character) => total + (gsm7ExtensionCharacters.has(character) ? 2 : 1),
    0,
  );
}
