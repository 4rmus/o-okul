import { HttpException, HttpStatus } from "@nestjs/common";

interface LoginAttemptState {
  count: number;
  lockedUntil: number;
}

const defaultMaxAttempts = 5;
const defaultLockMs = 15 * 60 * 1000;

export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly maxAttempts = defaultMaxAttempts,
    private readonly lockMs = defaultLockMs,
    private readonly now = () => Date.now(),
  ) {}

  assertAllowed(key: string): void {
    const state = this.attempts.get(key);
    if (!state) return;

    if (state.lockedUntil > this.now()) {
      throw new HttpException("LOGIN_LOCKED", HttpStatus.TOO_MANY_REQUESTS);
    }

    if (state.lockedUntil > 0) {
      this.attempts.delete(key);
    }
  }

  recordFailure(key: string): void {
    const current = this.attempts.get(key);
    const count = (current?.count ?? 0) + 1;
    this.attempts.set(key, {
      count,
      lockedUntil: count >= this.maxAttempts ? this.now() + this.lockMs : 0,
    });
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }
}

export function loginAttemptKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  return normalized || "unknown";
}
