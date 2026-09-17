import { unauthenticated } from "@job-to-invoice/domain";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type VerifiedAccessToken = {
  subject: string;
  email: string;
  expiresAt: Date;
};

export type JwtVerifier = (
  authorizationHeader: string | undefined,
) => Promise<VerifiedAccessToken>;

function parseBearer(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined || authorizationHeader.trim() === "") {
    throw unauthenticated();
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || token === undefined || token.length === 0) {
    throw unauthenticated();
  }
  return token;
}

function emailFromPayload(payload: JWTPayload): string {
  if (typeof payload["email"] === "string" && payload["email"].length > 0) {
    return payload["email"];
  }
  const metadata = payload["user_metadata"];
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as { email?: unknown }).email === "string"
  ) {
    return (metadata as { email: string }).email;
  }
  throw unauthenticated();
}

type VerifyKey = Parameters<typeof jwtVerify>[1];

export function createStaticKeyVerifier(options: {
  key: VerifyKey;
  issuer: string;
  audience: string;
}): JwtVerifier {
  return async (authorizationHeader) => {
    const token = parseBearer(authorizationHeader);
    try {
      const { payload } = await jwtVerify(token, options.key, {
        issuer: options.issuer,
        audience: options.audience,
        clockTolerance: 30,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw unauthenticated();
      }
      return {
        subject: payload.sub,
        email: emailFromPayload(payload),
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(0),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") {
        throw error;
      }
      throw unauthenticated();
    }
  };
}

export function createConfiguredJwtVerifier(options: {
  jwksUrl: string | undefined;
  issuer: string | undefined;
  audience: string | undefined;
}): JwtVerifier {
  const issuer = options.issuer;
  const audience = options.audience;
  const jwksUrl = options.jwksUrl;
  if (!jwksUrl || !issuer || !audience) {
    return async () => {
      throw unauthenticated();
    };
  }
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (authorizationHeader) => {
    const token = parseBearer(authorizationHeader);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        clockTolerance: 30,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw unauthenticated();
      }
      return {
        subject: payload.sub,
        email: emailFromPayload(payload),
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(0),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") {
        throw error;
      }
      throw unauthenticated();
    }
  };
}
