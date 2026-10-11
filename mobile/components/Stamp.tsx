// A rubber stamp: YES in stamp blue, NO in stamp red, SKIP in ink.
// Three sizes: sm for list tags, md for the reveal, lg for the card overlay.

import { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii } from "@/lib/theme";

export type StampKind = "yes" | "no" | "skip";

const WORD: Record<StampKind, string> = { yes: "YES", no: "NO", skip: "SKIP" };
const INK: Record<StampKind, string> = { yes: colors.yes, no: colors.no, skip: colors.ink2 };
const TILT: Record<StampKind, string> = { yes: "-8deg", no: "8deg", skip: "0deg" };

export const Stamp = memo(function Stamp({
  kind,
  size = "md",
  filled = false,
  tilt = false,
  style,
}: {
  kind: StampKind;
  size?: "sm" | "md" | "lg";
  /** Solid ink with paper text, for the side you chose. */
  filled?: boolean;
  tilt?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ink = INK[kind];
  return (
    <View
      style={[
        styles.base,
        sizes[size].box,
        { borderColor: ink },
        filled && { backgroundColor: ink },
        tilt && { transform: [{ rotateZ: TILT[kind] }] },
        style,
      ]}
      accessibilityLabel={WORD[kind]}
    >
      <Text style={[styles.text, sizes[size].text, { color: filled ? colors.onInk : ink }]}>{WORD[kind]}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button / 2,
  },
  text: { fontWeight: "900", includeFontPadding: false },
});

const sizes = {
  sm: StyleSheet.create({
    box: { borderWidth: 1.5, paddingHorizontal: 6, height: 20, borderRadius: 5 },
    text: { fontSize: 11, lineHeight: 14, letterSpacing: 1 },
  }),
  md: StyleSheet.create({
    box: { borderWidth: 2, paddingHorizontal: 10, height: 30, borderRadius: 7 },
    text: { fontSize: 14, lineHeight: 18, letterSpacing: 1.4 },
  }),
  lg: StyleSheet.create({
    box: { borderWidth: 4, paddingHorizontal: 14, height: 56, borderRadius: 10 },
    text: { fontSize: 34, lineHeight: 40, letterSpacing: 3 },
  }),
} as const;
