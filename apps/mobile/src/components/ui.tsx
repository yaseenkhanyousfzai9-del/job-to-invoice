import { type ReactNode, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, layout, typography } from "../theme/tokens";

export function Screen(props: { children: ReactNode; testID?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.screen} testID={props.testID}>
        {props.children}
      </View>
    </SafeAreaView>
  );
}

export function Title(props: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {props.children}
    </Text>
  );
}

export function Body(props: { children: string }) {
  return <Text style={styles.body}>{props.children}</Text>;
}

export function Secondary(props: { children: string }) {
  return <Text style={styles.secondary}>{props.children}</Text>;
}

export function ErrorBanner(props: { message: string | null; onRetry?: () => void }) {
  if (!props.message) {
    return null;
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <Text style={styles.bannerText}>{props.message}</Text>
      {props.onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={props.onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  keyboardType?: TextInputProps["keyboardType"];
  autoComplete?: TextInputProps["autoComplete"];
  textContentType?: TextInputProps["textContentType"];
  secureTextEntry?: boolean;
  placeholder?: string;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  editable?: boolean;
  maxLength?: number;
}) {
  const inputId = useMemo(() => props.label.replace(/\s+/g, "-").toLowerCase(), [props.label]);
  return (
    <View style={styles.field}>
      <Text nativeID={`${inputId}-label`} style={styles.label}>
        {props.label}
      </Text>
      <TextInput
        accessibilityLabel={props.label}
        accessibilityLabelledBy={`${inputId}-label`}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        autoComplete={props.autoComplete}
        textContentType={props.textContentType}
        secureTextEntry={props.secureTextEntry}
        placeholder={props.placeholder}
        placeholderTextColor={colors.secondary}
        autoCapitalize={props.autoCapitalize ?? "none"}
        autoCorrect={false}
        editable={props.editable}
        maxLength={props.maxLength}
        allowFontScaling
        style={[styles.input, props.error ? styles.inputError : null]}
      />
      {props.error ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled, busy: Boolean(props.loading) }}
      onPress={props.onPress}
      disabled={disabled}
      style={[styles.button, disabled ? styles.buttonDisabled : null]}
    >
      {props.loading ? (
        <View style={styles.buttonLoading}>
          <ActivityIndicator color="#ffffff" />
          <Text style={styles.buttonLabel}>{props.label}</Text>
        </View>
      ) : (
        <Text style={styles.buttonLabel}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function TextLink(props: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={styles.link}
    >
      <Text style={styles.linkText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: {
    flex: 1,
    padding: layout.screenGutter,
    gap: 12,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: typography.screenTitle.fontWeight,
    color: colors.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
  secondary: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 8,
  },
  bannerText: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
  },
  retry: {
    minHeight: layout.minTouchTarget,
    justifyContent: "center",
  },
  retryText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: typography.body.fontSize,
  },
  field: { gap: 6 },
  label: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
    fontWeight: "600",
  },
  input: {
    minHeight: layout.buttonMinHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    paddingHorizontal: 12,
    fontSize: typography.body.fontSize,
    color: colors.text,
    backgroundColor: "#ffffff",
  },
  inputError: {
    borderColor: colors.primary,
  },
  fieldError: {
    fontSize: typography.secondary.fontSize,
    color: colors.primary,
  },
  button: {
    minHeight: layout.buttonMinHeight,
    borderRadius: layout.cornerRadius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: typography.body.fontSize,
    fontWeight: "600",
  },
  link: {
    minHeight: layout.minTouchTarget,
    justifyContent: "center",
  },
  linkText: {
    color: colors.primary,
    fontSize: typography.body.fontSize,
  },
});
