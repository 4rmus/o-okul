# Browser push ownership and endpoint policy

Browser notification permission belongs to an origin, not to a person. An existing permission is never evidence that the next account has opted in.

On logout, a new sign-in, unknown legacy ownership, or an account/tenant change, the web client clears its browser binding, closes existing notifications and unsubscribes the old browser subscription before exposing another account. Same-account session renewal preserves the binding. This cleanup runs even if push UI is disabled or the logout API is offline. A failed unsubscribe prevents another account from being accepted; explicit registration also fails closed when IndexedDB or Web Locks are unavailable.

The browser persists only a SHA-256 digest of tenant/account identity and an opaque device registration ID in `o-okul-push-binding` IndexedDB. It never stores credentials, subscription endpoints, notification content or names there. This pseudonymous state is replaced on account changes and cleared on logout. Browser storage deletion is treated as unknown ownership and requires a new opt-in. No service-worker fetch handler or response cache is installed.

Explicit opt-in uses the captured tenant/user/session/persona/membership context and the current access token; it never refreshes or replays a registration for a different actor. Web Locks serialize registration, cleanup, notification display and clicks across tabs and the service worker. The worker payload adds only the opaque device ID to the existing title/internal-link fields. An absent or mismatched binding suppresses display and navigation, including already-in-flight messages and legacy payloads.

## Server binding and queued jobs

`NotificationDeviceToken.webPushEndpointHash` is the SHA-256 digest of the canonical endpoint. A unique tenant/hash index makes concurrent claims resolve to one row and owner. An ownership, subject, key, or disabled-to-active change replaces the registration ID in that atomic upsert; previously queued announcement IDs no longer resolve. The worker additionally requires an active, nonlegacy registration. Across origins browsers isolate subscriptions; on a shared origin the browser owner includes tenant identity and retires the previous subscription before another tenant is exposed.

Non-web providers continue to accept opaque tokens scoped to tenant/account/provider. They are not sent through the VAPID web-push sender. Public device responses contain neither subscription tokens nor user IDs.

## Supported services

Both registration and the worker validate with the same parser, including stored legacy tokens. Only HTTPS on the standard port is accepted, with no user info, fragment, whitespace, backslash, encoded host or IP literal. JSON ordering and unused subscription properties do not create new endpoint identities; endpoints are otherwise opaque and query strings are preserved. The allowlist is compiled, not user-configurable.

| Browser service | Accepted hostname rule |
| --- | --- |
| Google FCM (Chrome/Chromium) | Exact `fcm.googleapis.com` |
| Mozilla production (Firefox) | Exact `updates.push.services.mozilla.com` |
| Apple web push (Safari and installed iOS/iPadOS web apps) | Exact `web.push.apple.com` |
| Microsoft WNS (Edge) | One DNS label immediately before `.notify.windows.com`, including `webpush` and regional `wns2-*` labels |

Lookalikes, extra nested labels, apex domains, native Apple APNs API hosts, and development/staging/custom push services are rejected. Apple publishes a broader network-access recommendation for `*.push.apple.com`; this implementation supports the web-push endpoint above, not all APNs services. Supporting another service requires code, tests and a policy review.

The pinned `web-push` 3.6.7 transport uses Node `https.request`, does not follow redirects, and rejects non-2xx responses. The wrapper also rejects a non-2xx success return from an injected transport. There is no redirect retry, proxy override, or caller-supplied transport option. Existing 404/410 handling disables expired registrations. Endpoint allowlisting trusts the selected providers' DNS/TLS infrastructure; an outbound network policy can independently restrict provider traffic.

Provider references: [Google browser push guide](https://web.dev/articles/push-notifications-web-push-protocol), [Mozilla production endpoints](https://mozilla-services.github.io/autopush-rs/), [Apple web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Microsoft WNS](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview), [pinned sender source](https://github.com/web-push-libs/web-push/blob/v3.6.7/src/web-push-lib.js).

## Migration and rollout

Migration `20261111152000_bind_web_push_device_owner` adds the hash and uniqueness index, changes opaque-token uniqueness to include provider, and disables all existing web-push rows. Existing token history remains until an exact disabled legacy row must be removed to permit its canonical re-registration. Other provider rows are unchanged. No tenant tables, relations, RLS policies, privileges, or seed fixtures are added or weakened.

Deploy the migration before the matching API/worker/web release. Keep push sending paused throughout a mixed-version rollout, because old workers lack the send guard and binding IDs, and old clients lack browser ownership cleanup. Resume only with all components updated. Users must open the updated application and explicitly choose “Push iznini aç” again; an already-granted browser permission does not silently register them. Unvisited/offline old application versions cannot be retroactively updated, and provider messages accepted before rollout cannot be recalled. No live migration, provider call, key change or deployment is performed by this change.

Local checks: focused API and worker tests, `node --test scripts/check-web-push-security.test.mjs`, API/worker/web typechecks, and static DB/RLS checks. The browser test executes the real client/service-worker sources with deterministic storage/transport doubles, including a delayed display racing logout; it does not prove actual browser/provider delivery. The restricted-app PostgreSQL race test is `apps/api/src/notification-device/notification-device.postgres.test.ts`, using the existing `EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL` / `EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL` and `ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED` CI contract. Live PostgreSQL and browser/provider evidence remain separate from local checks.
