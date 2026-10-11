// Lane chips above the deck. Four lanes, one selected.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, space, type } from "@/lib/theme";
import type { LaneFilter } from "@/lib/types";

export const LANES: { key: LaneFilter; label: string }[] = [
  { key: "foryou", label: "For you" },
  { key: "live", label: "Live" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
];

export function LaneChips({
  value,
  onChange,
  disabled = false,
}: {
  value: LaneFilter;
  onChange: (lane: LaneFilter) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      {LANES.map((lane) => {
        const selected = lane.key === value;
        return (
          <Pressable
            key={lane.key}
            testID={`lane-${lane.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(lane.key)}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>{lane.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xl },
  chip: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { ...type.small, color: colors.muted, fontWeight: "600" },
  textSelected: { color: colors.onAccent },
  pressed: { opacity: 0.8 },
});
