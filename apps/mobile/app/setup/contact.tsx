import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { US_STATES, validateSetupStep2 } from "@job-to-invoice/domain";
import {
  Body,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../src/components/ui";
import { useSetupDraft } from "../../src/providers/SetupDraftProvider";

export default function SetupContactScreen() {
  const router = useRouter();
  const { draft, update } = useSetupDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onNext() {
    const nextErrors = validateSetupStep2(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
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
            onChangeText={(value) => update({ contact_name: value })}
            error={errors["contact_name"]}
            autoCapitalize="words"
          />
          <Field
            label="Contact email"
            value={draft.contact_email}
            onChangeText={(value) => update({ contact_email: value })}
            error={errors["contact_email"]}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            label="Contact phone (optional, E.164)"
            value={draft.contact_phone}
            onChangeText={(value) => update({ contact_phone: value })}
            error={errors["contact_phone"]}
            keyboardType="phone-pad"
            placeholder="+15551234567"
          />
          <Field
            label="Address line 1"
            value={draft.address_line1}
            onChangeText={(value) => update({ address_line1: value })}
            error={errors["address_line1"]}
            textContentType="streetAddressLine1"
            autoCapitalize="words"
          />
          <Field
            label="Address line 2 (optional)"
            value={draft.address_line2}
            onChangeText={(value) => update({ address_line2: value })}
            error={errors["address_line2"]}
            textContentType="streetAddressLine2"
            autoCapitalize="words"
          />
          <Field
            label="City"
            value={draft.city}
            onChangeText={(value) => update({ city: value })}
            error={errors["city"]}
            textContentType="addressCity"
            autoCapitalize="words"
          />
          <Field
            label="State"
            value={draft.state}
            onChangeText={(value) => update({ state: value.toUpperCase().slice(0, 2) })}
            error={errors["state"]}
            autoCapitalize="characters"
            maxLength={2}
            placeholder="TX"
          />
          <Secondary>{`Two-letter US state or DC. Examples: ${US_STATES.slice(0, 5).join(", ")}.`}</Secondary>
          <Field
            label="ZIP"
            value={draft.zip}
            onChangeText={(value) => update({ zip: value })}
            error={errors["zip"]}
            keyboardType="number-pad"
            textContentType="postalCode"
            placeholder="78701"
          />
          <PrimaryButton label="Continue" onPress={onNext} />
        </KeyboardAvoidingView>
      </ScrollView>
    </Screen>
  );
}
