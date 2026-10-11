// Loading, error and empty states. Every screen uses these so the copy stays consistent.
// Loading always carries a label: a bare spinner tells nobody anything.

import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, hit, radii, space, type } from "@/lib/theme";

export function LoadingView({ label }: { label: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.ink2} />
      <Text style={[type.small, styles.gapTop]}>{label}</Text>
    </View>
  );
}

export function ErrorView({
  message,
  onRetry,
  refreshing = false,
}: {
  message: string;
  onRetry: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.center}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRetry} tintColor={colors.ink2} />}
    >
      <Text style={[type.heading, styles.centerText]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}

export function EmptyView({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Text style={[type.heading, styles.centerText]}>{title}</Text>
      {hint ? <Text style={[type.small, styles.centerText, styles.gapTop]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xxxl,
    paddingVertical: space.huge,
  },
  centerText: { textAlign: "center" },
  gapTop: { marginTop: space.sm },
  retry: {
    marginTop: space.xl,
    minHeight: hit.min,
    paddingHorizontal: space.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { ...type.body, color: colors.onInk, fontWeight: "700" },
  pressed: { opacity: 0.75 },
});
