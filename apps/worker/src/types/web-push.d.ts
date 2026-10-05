// ponytail: minimal typings for the subset of web-push we call; avoids adding @types/web-push.
declare module "web-push" {
  namespace webPush {
    interface PushSubscription {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }
    interface RequestOptions {
      TTL?: number;
      timeout?: number;
      vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    }
    interface SendResult {
      statusCode: number;
      body: string;
      headers: Record<string, string>;
    }
    function sendNotification(
      subscription: PushSubscription,
      payload?: string | Buffer | null,
      options?: RequestOptions,
    ): Promise<SendResult>;
    function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  }
  export = webPush;
}
