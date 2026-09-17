import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, layout, typography } from "../src/theme/tokens";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          Job to Invoice
        </Text>
        <Text style={styles.body}>Development foundation</Text>
        <Text style={styles.secondary}>
          Login, customers, jobs, quotes, and invoices are not implemented yet.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    padding: layout.screenGutter,
    gap: 8,
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
});
