import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MeData } from "@job-to-invoice/domain";
import { resolveOwnerNavigation, validateEmail, type OwnerNavigation } from "@job-to-invoice/domain";
import { DomainApiError, fetchMe } from "../lib/api";
import { GENERIC_CODE_SENT, mapProviderAuthError } from "../lib/auth-errors";
import { isAuthProviderConfigured } from "../lib/config";
import {
  createLatestOtpRequestState,
  resolveCanonicalVerifyEmail,
} from "../lib/otp-request-state";
import {
  createSendSingleFlight,
  prepareVerifyToken,
  runSendOtpFlow,
} from "../lib/otp-send-flow";
import { getSupabaseClient } from "../lib/supabase";
import {
  BOOTSTRAP_FAILED_MESSAGE,
  createVerifySingleFlight,
  runVerifyAuthFlow,
} from "../lib/verify-auth-flow";

type AuthContextValue = {
  loading: boolean;
  navigation: OwnerNavigation;
  me: MeData | null;
  accessToken: string | null;
  pendingEmail: string | null;
  error: string | null;
  codeSentMessage: string | null;
  cooldownUntil: number | null;
  sending: boolean;
  verifying: boolean;
  otpGeneration: number;
  bootstrapRetryable: boolean;
  sendCode: (email: string) => Promise<boolean>;
  verifyCode: (routeEmailHint: string | undefined, code: string) => Promise<boolean>;
  retryBootstrap: () => Promise<boolean>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  setPendingEmail: (email: string | null) => void;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function authFlowLog(
  stage: string,
  extra?: Record<string, string | number | boolean | null>,
): void {
  if (!__DEV__) {
    return;
  }
  console.warn("[auth-flow]", stage, extra ?? {});
}

function authVerifyStateLog(extra: Record<string, string | number | boolean | null>): void {
  if (!__DEV__) {
    return;
  }
  console.warn("[auth-verify-state]", extra);
}

function authSendStateLog(extra: Record<string, string | number | boolean | null>): void {
  if (!__DEV__) {
    return;
  }
  console.warn("[auth-send-state]", extra);
}

export function AuthProvider(props: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeData | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeSentMessage, setCodeSentMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpGeneration, setOtpGeneration] = useState(0);
  const [bootstrapRetryable, setBootstrapRetryable] = useState(false);
  const verifyFlight = useRef(createVerifySingleFlight()).current;
  const sendFlight = useRef(createSendSingleFlight()).current;
  const latestOtpRequest = useRef(createLatestOtpRequestState()).current;

  const loadFromSession = useCallback(async () => {
    if (!isAuthProviderConfigured()) {
      setAccessToken(null);
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      setAccessToken(token);
      if (!token) {
        setMe(null);
        return;
      }
      try {
        setMe(await fetchMe(token));
        setBootstrapRetryable(false);
      } catch (cause) {
        if (cause instanceof DomainApiError && cause.api.status === 401) {
          await supabase.auth.signOut();
          setAccessToken(null);
          setMe(null);
          return;
        }
        setBootstrapRetryable(true);
        setError(BOOTSTRAP_FAILED_MESSAGE);
      }
    } catch (cause) {
      setError(mapProviderAuthError(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFromSession();
  }, [loadFromSession]);

  const sendCode = useCallback(async (email: string) => {
    const parsed = validateEmail(email);
    if (parsed.error) {
      setError(parsed.error);
      setBootstrapRetryable(false);
      return false;
    }
    if (!isAuthProviderConfigured()) {
      setError(mapProviderAuthError(new Error("AUTH_NOT_CONFIGURED")).message);
      setBootstrapRetryable(false);
      return false;
    }

    setSending(true);
    setBootstrapRetryable(false);
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionPresentBeforeOtp = Boolean(sessionData.session?.access_token);

      const result = await runSendOtpFlow({
        email: parsed.display,
        flight: sendFlight,
        generation: {
          get current() {
            return latestOtpRequest.current?.generation ?? 0;
          },
          bump: () => latestOtpRequest.recordSuccessfulSend(parsed.display).generation,
        },
        sessionPresentBeforeOtp,
        log: authFlowLog,
        signInWithOtp: async (input) => {
          const response = await supabase.auth.signInWithOtp({
            email: input.email,
          });
          return { error: response.error };
        },
      });

      if (result.kind === "busy") {
        return false;
      }
      if (result.kind === "provider_error") {
        const mapped = mapProviderAuthError(result.error);
        setError(mapped.message);
        if (mapped.retryAfterSeconds) {
          setCooldownUntil(Date.now() + mapped.retryAfterSeconds * 1000);
        }
        return false;
      }

      setPendingEmail(parsed.display);
      setCodeSentMessage(GENERIC_CODE_SENT);
      setCooldownUntil(Date.now() + 60_000);
      setOtpGeneration(result.generation);
      setError(null);
      authSendStateLog({
        generation: result.generation,
        canonical_email_updated: true,
      });
      return true;
    } catch (cause) {
      setError(mapProviderAuthError(cause).message);
      return false;
    } finally {
      setSending(false);
    }
  }, [latestOtpRequest, sendFlight]);

  const verifyCode = useCallback(async (routeEmailHint: string | undefined, code: string) => {
    const prepared = prepareVerifyToken(code);
    if (!prepared.ok) {
      setError(prepared.message);
      setBootstrapRetryable(false);
      return false;
    }

    const resolved = resolveCanonicalVerifyEmail({
      pendingEmail: latestOtpRequest.current?.email ?? pendingEmail,
      routeEmail: routeEmailHint,
    });
    if (!resolved.email) {
      setError("Request a new sign-in code.");
      setBootstrapRetryable(false);
      return false;
    }

    if (!isAuthProviderConfigured()) {
      setError(mapProviderAuthError(new Error("AUTH_NOT_CONFIGURED")).message);
      setBootstrapRetryable(false);
      return false;
    }
    if (!verifyFlight.tryBegin()) {
      authFlowLog("verify_started", {
        skipped: "busy",
        generation: latestOtpRequest.current?.generation ?? otpGeneration,
      });
      return false;
    }

    const generation = latestOtpRequest.current?.generation ?? otpGeneration;
    const pendingPresent = Boolean(latestOtpRequest.current?.email ?? pendingEmail);
    const routePresent = Boolean(routeEmailHint && String(routeEmailHint).trim());
    const pendingEqualsRoute =
      pendingPresent &&
      routePresent &&
      (latestOtpRequest.current?.email ?? pendingEmail) === routeEmailHint?.trim();

    setVerifying(true);
    setError(null);
    setBootstrapRetryable(false);
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionPresentBeforeVerify = Boolean(sessionData.session?.access_token);

      authVerifyStateLog({
        generation,
        pending_email_present: pendingPresent,
        route_email_present: routePresent,
        pending_equals_route: pendingEqualsRoute,
        verify_email_source: resolved.source,
        token_length: prepared.token.length,
        session_present_before_verify: sessionPresentBeforeVerify,
      });

      const result = await runVerifyAuthFlow({
        email: resolved.email,
        code: prepared.token,
        generation,
        log: authFlowLog,
        verifyOtp: async (input) => {
          const response = await supabase.auth.verifyOtp(input);
          return {
            data: { session: response.data.session },
            error: response.error,
          };
        },
        fetchMe,
      });

      if (result.kind === "otp_invalid") {
        setError(result.message);
        return false;
      }
      if (result.kind === "bootstrap_failed") {
        setAccessToken(result.accessToken);
        setPendingEmail(resolved.email);
        setBootstrapRetryable(true);
        setError(result.message);
        return false;
      }
      if (result.kind === "busy") {
        return false;
      }

      setAccessToken(result.accessToken);
      setMe(result.me);
      setPendingEmail(resolved.email);
      setBootstrapRetryable(false);
      setError(null);
      return true;
    } finally {
      verifyFlight.end();
      setVerifying(false);
    }
  }, [latestOtpRequest, otpGeneration, pendingEmail, verifyFlight]);

  const retryBootstrap = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    authFlowLog("bootstrap_started", { retry: true });
    setError(null);
    try {
      const nextMe = await fetchMe(accessToken);
      setMe(nextMe);
      setBootstrapRetryable(false);
      authFlowLog("bootstrap_success", { retry: true });
      return true;
    } catch (cause) {
      const status = cause instanceof DomainApiError ? cause.api.status : null;
      authFlowLog("bootstrap_status", { status, retry: true });
      if (cause instanceof DomainApiError && cause.api.status === 401) {
        if (isAuthProviderConfigured()) {
          const supabase = getSupabaseClient();
          await supabase.auth.signOut();
        }
        setAccessToken(null);
        setMe(null);
        setPendingEmail(null);
        setBootstrapRetryable(false);
        setError("Sign in to continue.");
        return false;
      }
      setBootstrapRetryable(true);
      setError(BOOTSTRAP_FAILED_MESSAGE);
      return false;
    }
  }, [accessToken]);

  const refreshMe = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setMe(await fetchMe(accessToken));
  }, [accessToken]);

  const signOut = useCallback(async () => {
    if (isAuthProviderConfigured()) {
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
    }
    setAccessToken(null);
    setMe(null);
    setPendingEmail(null);
    setError(null);
    setBootstrapRetryable(false);
    latestOtpRequest.clear();
    setOtpGeneration(0);
  }, [latestOtpRequest]);

  const navigation = resolveOwnerNavigation({
    hasSession: Boolean(accessToken),
    me,
  });

  const value = useMemo(
    () => ({
      loading,
      navigation,
      me,
      accessToken,
      pendingEmail,
      error,
      codeSentMessage,
      cooldownUntil,
      sending,
      verifying,
      otpGeneration,
      bootstrapRetryable,
      sendCode,
      verifyCode,
      retryBootstrap,
      refreshMe,
      signOut,
      setPendingEmail,
      clearError: () => {
        setError(null);
        setBootstrapRetryable(false);
      },
    }),
    [
      loading,
      navigation,
      me,
      accessToken,
      pendingEmail,
      error,
      codeSentMessage,
      cooldownUntil,
      sending,
      verifying,
      otpGeneration,
      bootstrapRetryable,
      sendCode,
      verifyCode,
      retryBootstrap,
      refreshMe,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
