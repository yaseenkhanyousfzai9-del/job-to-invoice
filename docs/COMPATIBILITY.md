# Compatibility

Authority: PRD ARC05. Record versions that CUST-AUTH-01 added. The lockfile remains the install source of truth.

| Package | Workspace | Range | Role |
|---|---|---|---|
| `jose` | `apps/api` | `^6.1.0` | Access-token signature/issuer/audience/expiry verification via JWKS |
| `postgres` | `apps/api` | `^3.4.7` | API database client (`DATABASE_URL_API`) |
| `@supabase/supabase-js` | `apps/mobile` | `^2.57.4` | Owner OTP send/verify against public Auth only |
| `expo-secure-store` | `apps/mobile` | `~14.2.3` | OS-backed session storage for Expo SDK 53 |

Do not put service-role keys, `DATABASE_URL_*`, or JWT secrets in `apps/mobile`.
