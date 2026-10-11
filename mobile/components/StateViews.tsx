// Loading, error and empty states. Every screen uses these so the copy stays consistent.

import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, hit, radii, space, type } from "@/lib/theme";

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[type.small, styles.gapTop]}>{label}</Text> : null}
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRetry} tintColor={colors.accent} />}
    >
      <Text style={[type.heading, styles.centerText]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.retryText}>Retry</Text>
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
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { ...type.body, color: colors.paper },
  pressed: { opacity: 0.7 },
});
