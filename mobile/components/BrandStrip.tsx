// "Powered by Gemini Prediction Markets", set as a strip: a hairline on each side
// of small caps. Text only, by design. Never a logo.

import { memo } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors, credit, space, type } from "@/lib/theme";

export const BrandStrip = memo(function BrandStrip({
  variant = "rules",
  style,
}: {
  /** "rules" draws hairlines on both sides; "plain" is text only for tight footers. */
  variant?: "rules" | "plain";
  style?: ViewStyle;
}) {
  if (variant === "plain") {
    return (
      <Text style={[styles.plain, style]} accessibilityRole="text">
        {credit.poweredBy}
      </Text>
    );
  }
  return (
    <View style={[styles.row, style]} accessibilityRole="text" accessibilityLabel={credit.poweredBy}>
      <View style={styles.rule} />
      <Text style={styles.text}>{credit.poweredBy}</Text>
      <View style={styles.rule} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, alignSelf: "stretch" },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.lineStrong },
  text: { ...type.label, color: colors.ink2, textAlign: "center" },
  plain: { ...type.label, color: colors.ink3, textAlign: "center" },
});
