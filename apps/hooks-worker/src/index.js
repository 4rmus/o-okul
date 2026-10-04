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

  return json({ errorCode: "NOT_FOUND" }, 404);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

if (typeof process !== "undefined" && process.argv.includes("--smoke")) {
  const { strict: assert } = await import("node:assert");
  const env = { HOOKS_TOKEN: "test-token-123456789012345678901234" };
  const post = (path, body) => handleRequest(new Request(`https://hooks.example.com${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.HOOKS_TOKEN}` },
    body,
  }), env);
  const health = await handleRequest(new Request("https://hooks.example.com/health"), env);
  const alert = await post("/alert", "{}");
  // Notifications go through infra/notification-gateway; this worker must never report a fake "sent".
  const notification = await post("/notification", JSON.stringify({ messages: [{ channel: "EMAIL", to: "ops@o-okul.com", body: "ok" }] }));

  assert.equal(health.status, 200, "health smoke failed");
  assert.equal(alert.status, 200, "alert smoke failed");
  assert.equal(notification.status, 404, "notification route must be gone");
  console.log("hooks-worker smoke passed");
}
