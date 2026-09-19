import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { US_STATES, type WorkspaceSetupDraft } from "@job-to-invoice/domain";
import {
  Body,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../src/components/ui";
import {
  clearSetupFieldError,
  normalizeSetupStateInput,
  normalizeSetupZipInput,
  runSetupStep2Continue,
} from "../../src/features/setup/setupContactForm";
import { useSetupDraft } from "../../src/providers/SetupDraftProvider";

function setupContactDiag(extra: Record<string, string | number | boolean | null>): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  console.warn("[setup-contact-diag]", extra);
}

export default function SetupContactScreen() {
  const router = useRouter();
  const { draft, update } = useSetupDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function patchField(patch: Partial<WorkspaceSetupDraft>, clearKey?: string) {
    update(patch);
    if (clearKey) {
      setErrors((current) => clearSetupFieldError(current, clearKey));
    }
  }

  function onNext() {
    // Always validate the latest shared draft, not a stale render closure.
    const current = draftRef.current;
    const result = runSetupStep2Continue(current);
    setupContactDiag({
      state_present: result.statePresent,
      state_length: result.stateLength,
      state_normalized_valid: result.stateNormalizedValid,
      zip_present: result.zipPresent,
      zip_length: result.zipLength,
      zip_format_valid: result.zipFormatValid,
      address_validation_success: result.canAdvance,
    });
    setErrors(result.errors);
    if (result.canAdvance) {
      router.push("/setup/defaults");
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 12 }}>
          <Title>Business contact</Title>
          <Body>Step 2 of 3. Enter the US business address customers will see.</Body>
          <Field
            label="Contact name"
            value={draft.contact_name}
            onChangeText={(value) => patchField({ contact_name: value }, "contact_name")}
            error={errors["contact_name"]}
            autoCapitalize="words"
          />
          <Field
            label="Contact email"
            value={draft.contact_email}
            onChangeText={(value) => patchField({ contact_email: value }, "contact_email")}
            error={errors["contact_email"]}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            label="Contact phone (optional, E.164)"
            value={draft.contact_phone}
            onChangeText={(value) => patchField({ contact_phone: value }, "contact_phone")}
            error={errors["contact_phone"]}
            keyboardType="phone-pad"
            placeholder="+15551234567"
          />
          <Field
            label="Address line 1"
            value={draft.address_line1}
            onChangeText={(value) => patchField({ address_line1: value }, "address_line1")}
            error={errors["address_line1"]}
            textContentType="streetAddressLine1"
            autoCapitalize="words"
          />
          <Field
            label="Address line 2 (optional)"
            value={draft.address_line2}
            onChangeText={(value) => patchField({ address_line2: value }, "address_line2")}
            error={errors["address_line2"]}
            textContentType="streetAddressLine2"
            autoCapitalize="words"
          />
          <Field
            label="City"
            value={draft.city}
            onChangeText={(value) => patchField({ city: value }, "city")}
            error={errors["city"]}
            textContentType="addressCity"
            autoCapitalize="words"
          />
          <Field
            label="State"
            value={draft.state}
            onChangeText={(value) =>
              patchField({ state: normalizeSetupStateInput(value) }, "state")
            }
            error={errors["state"]}
            autoCapitalize="characters"
            maxLength={2}
            placeholder="e.g. CA"
          />
          <Secondary>{`Two-letter US state or DC. Examples: ${US_STATES.slice(0, 5).join(", ")}.`}</Secondary>
          <Field
            label="ZIP"
            value={draft.zip}
            onChangeText={(value) => patchField({ zip: normalizeSetupZipInput(value) }, "zip")}
            error={errors["zip"]}
            keyboardType="number-pad"
            textContentType="postalCode"
            maxLength={10}
            placeholder="e.g. 12345"
          />
          <PrimaryButton label="Continue" onPress={onNext} />
        </KeyboardAvoidingView>
      </ScrollView>
    </Screen>
  );
}
