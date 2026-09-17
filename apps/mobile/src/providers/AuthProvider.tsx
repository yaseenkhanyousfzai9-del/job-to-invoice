import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeData } from "@job-to-invoice/domain";
import { resolveOwnerNavigation, validateEmail, type OwnerNavigation } from "@job-to-invoice/domain";
import { DomainApiError, fetchMe } from "../lib/api";
import { GENERIC_CODE_SENT, mapProviderAuthError } from "../lib/auth-errors";
import { isAuthProviderConfigured } from "../lib/config";
import { getSupabaseClient } from "../lib/supabase";

type AuthContextValue = {
  loading: boolean;
  navigation: OwnerNavigation;
  me: MeData | null;
  accessToken: string | null;
  pendingEmail: string | null;
  error: string | null;
  codeSentMessage: string | null;
  cooldownUntil: number | null;
  sendCode: (email: string) => Promise<boolean>;
  verifyCode: (email: string, code: string) => Promise<boolean>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  setPendingEmail: (email: string | null) => void;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider(props: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeData | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeSentMessage, setCodeSentMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);

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
      } catch (cause) {
        if (cause instanceof DomainApiError && cause.api.status === 401) {
          await supabase.auth.signOut();
          setAccessToken(null);
          setMe(null);
          return;
        }
        setError(
          cause instanceof DomainApiError
            ? cause.api.message
            : "Could not load your account.",
        );
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
      return false;
    }
    if (!isAuthProviderConfigured()) {
      setError(mapProviderAuthError(new Error("AUTH_NOT_CONFIGURED")).message);
      return false;
    }
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { error: providerError } = await supabase.auth.signInWithOtp({
        email: parsed.display,
        options: { shouldCreateUser: true },
      });
      if (providerError) {
        const mapped = mapProviderAuthError(providerError);
        setError(mapped.message);
        if (mapped.retryAfterSeconds) {
          setCooldownUntil(Date.now() + mapped.retryAfterSeconds * 1000);
        }
        return false;
      }
      setPendingEmail(parsed.display);
      setCodeSentMessage(GENERIC_CODE_SENT);
      setCooldownUntil(Date.now() + 60_000);
      return true;
    } catch (cause) {
      setError(mapProviderAuthError(cause).message);
      return false;
    }
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return false;
    }
    if (!isAuthProviderConfigured()) {
      setError(mapProviderAuthError(new Error("AUTH_NOT_CONFIGURED")).message);
      return false;
    }
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error: providerError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (providerError || !data.session) {
        setError(mapProviderAuthError(providerError ?? new Error("invalid")).message);
        return false;
      }
      setAccessToken(data.session.access_token);
      setMe(await fetchMe(data.session.access_token));
      setPendingEmail(email);
      return true;
    } catch (cause) {
      if (cause instanceof DomainApiError) {
        setError(cause.api.message);
        return false;
      }
      setError(mapProviderAuthError(cause).message);
      return false;
    }
  }, []);

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
  }, []);

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
      sendCode,
      verifyCode,
      refreshMe,
      signOut,
      setPendingEmail,
      clearError: () => setError(null),
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
      sendCode,
      verifyCode,
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
