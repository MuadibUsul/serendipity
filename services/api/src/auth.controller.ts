import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { AuthService, IssuedTokens } from "@serendipity/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { bearerOf } from "./callers.js";
import { ApiError } from "./errors.js";
import { AUTH } from "./tokens.js";

/** What a successful sign-in or refresh returns. Tokens are opaque; times are ISO 8601. */
export interface SessionBody {
  readonly user_id: string;
  /** This sign-in created the account (the app can greet a new person). */
  readonly new_account: boolean;
  readonly access_token: string;
  readonly access_expires_at: string;
  readonly refresh_token: string;
  readonly refresh_expires_at: string;
}

const sessionBody = (userId: string, newAccount: boolean, tokens: IssuedTokens): SessionBody => ({
  user_id: userId,
  new_account: newAccount,
  access_token: tokens.accessToken,
  access_expires_at: tokens.accessExpiresAt.toISOString(),
  refresh_token: tokens.refreshToken,
  refresh_expires_at: tokens.refreshExpiresAt.toISOString(),
});

function field(body: unknown, name: string): string {
  const value =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string" || value.length > 64) {
    throw new ApiError("invalid_request", `Send "${name}" as a string.`);
  }
  return value;
}

/**
 * Sign-in by phone and one-time code (ser-p01-10, CHG-001 D9). No response
 * says whether a number has an account; every response is `no-store`.
 * Deployed environments have no SMS provider yet, so they answer 503 here
 * rather than ever using the fake.
 */
@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AUTH) private readonly auth: AuthService | null) {}

  private service(): AuthService {
    if (this.auth === null) throw new ApiError("unavailable", "Sign-in is not available yet.");
    return this.auth;
  }

  /** Sends a code by SMS. 202: on its way; 429 with Retry-After: wait. */
  @Post("code")
  @HttpCode(202)
  @Header("cache-control", "no-store")
  async code(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ): Promise<{ resend_after_s: number }> {
    const result = await this.service().requestCode(field(body, "phone"), request.ip);
    if (result.ok) return { resend_after_s: result.resendAfterS };
    if (result.problem === "invalid_phone") {
      throw new ApiError("invalid_request", "Enter a mainland China mobile number.");
    }
    void reply.header("retry-after", String(result.retryAfterS));
    throw new ApiError("rate_limited", "Too many codes requested. Try again later.");
  }

  /** Signs in with the code. 400 `invalid_code` for any wrong, expired, spent or locked code. */
  @Post("session")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async session(@Body() body: unknown): Promise<SessionBody> {
    const result = await this.service().signIn(field(body, "phone"), field(body, "code"));
    if (result.ok) return sessionBody(result.userId, result.created, result.tokens);
    if (result.problem === "invalid_phone") {
      throw new ApiError("invalid_request", "Enter a mainland China mobile number.");
    }
    throw new ApiError("invalid_code", "The code is wrong or has expired.");
  }

  /** A new pair for a refresh token, which is spent. 401 for any token that will not do. */
  @Post("refresh")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async refresh(@Body() body: unknown): Promise<SessionBody> {
    const result = await this.service().refresh(field(body, "refresh_token"));
    if (!result.ok) throw new ApiError("unauthenticated");
    return sessionBody(result.userId, false, result.tokens);
  }

  /** Ends the session of the access token sent. Always 204: logging out twice is fine. */
  @Post("logout")
  @HttpCode(204)
  @Header("cache-control", "no-store")
  async logout(@Req() request: FastifyRequest): Promise<void> {
    const token = bearerOf(request.headers);
    if (token !== null) await this.service().logout(token);
  }
}
