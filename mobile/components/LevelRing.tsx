// A level ring: the level number inside, progress toward the next level around it.
// The arc springs to its value. Drawn with react-native-svg.

import { memo, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { colors, springs } from "@/lib/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const LevelRing = memo(function LevelRing({
  level,
  progress,
  size = 72,
  stroke = 7,
}: {
  level: number;
  /** 0 to 1. */
  progress: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = useSharedValue(0);

  useEffect(() => {
    value.set(withSpring(Math.min(1, Math.max(0, progress)), springs.reveal));
  }, [progress, value]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - value.get()),
  }));

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Level ${level}`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.paperDeep} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={arcProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.number, { fontSize: size * 0.4, lineHeight: size * 0.46 }]}>{level}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  number: { fontWeight: "800", color: colors.ink, letterSpacing: -1, fontVariant: ["tabular-nums"] },
});
