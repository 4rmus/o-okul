import { Module } from "@nestjs/common";
import { authUserStoreToken, createAuthUserStore } from "./auth-user-store.js";
import { createLoginAttemptLimiter, loginAttemptLimiterToken } from "./login-attempt-limiter.js";
import { createPasswordResetStore, passwordResetStoreToken } from "./password-reset-store.js";
import { authSessionStoreToken, createSessionStore } from "./session-store.js";

@Module({
  providers: [
    {
      provide: loginAttemptLimiterToken,
      useFactory: createLoginAttemptLimiter,
    },
    {
      provide: authUserStoreToken,
      useFactory: createAuthUserStore,
    },
    {
      provide: authSessionStoreToken,
      useFactory: createSessionStore,
    },
    {
      provide: passwordResetStoreToken,
      useFactory: createPasswordResetStore,
    },
  ],
  exports: [loginAttemptLimiterToken, authUserStoreToken, authSessionStoreToken, passwordResetStoreToken],
})
export class AuthPersistenceModule {}
