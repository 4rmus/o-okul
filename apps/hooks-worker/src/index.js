const AUTH_ERROR = "UNAUTHORIZED";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ status: "ok" });
  }

  if (request.method !== "POST") {
    return json({ errorCode: "METHOD_NOT_ALLOWED" }, 405);
  }

  const token = env.HOOKS_TOKEN?.trim();
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return json({ errorCode: AUTH_ERROR }, 401);
  }

  if (url.pathname === "/alert") {
    await request.json().catch(() => ({}));
    return json({ ok: true });
  }

  if (url.pathname === "/notification") {
    const body = await request.json().catch(() => ({}));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return json({
      results: messages.map((message, index) => ({
        channel: message.channel,
        to: message.to,
        status: "sent",
        providerMessageId: `o-okul-hooks-${Date.now()}-${index + 1}`,
      })),
    });
  }

  return json({ errorCode: "NOT_FOUND" }, 404);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

if (typeof process !== "undefined" && process.argv.includes("--smoke")) {
  const env = { HOOKS_TOKEN: "test-token-123456789012345678901234" };
  const alert = await handleRequest(new Request("https://hooks.example.com/alert", {
    method: "POST",
    headers: { authorization: `Bearer ${env.HOOKS_TOKEN}` },
    body: "{}",
  }), env);
  const notification = await handleRequest(new Request("https://hooks.example.com/notification", {
    method: "POST",
    headers: { authorization: `Bearer ${env.HOOKS_TOKEN}` },
    body: JSON.stringify({ messages: [{ channel: "EMAIL", to: "ops@o-okul.com", body: "ok" }] }),
  }), env);

  console.assert(alert.status === 200, "alert smoke failed");
  console.assert(notification.status === 200, "notification smoke failed");
  console.log("hooks-worker smoke passed");
}
