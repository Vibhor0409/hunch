// The Hunch mark, breathing. Used wherever a wait needs a face: the reveal while the
// market answers, and the card back while context loads. Always pair it with a label.

import { memo, useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { HunchMark } from "@/components/HunchMark";
import { colors } from "@/lib/theme";

const HALF_BEAT_MS = 650;

export const PulsingMark = memo(function PulsingMark({
  size = 72,
  background = colors.card,
}: {
  size?: number;
  /** The surface the mark sits on, so its notches read as cut paper. */
  background?: string;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: HALF_BEAT_MS, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: HALF_BEAT_MS, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  // The wrapper animates, not the SVG.
  const style = useAnimatedStyle(() => ({
    opacity: 0.7 + 0.3 * pulse.get(),
    transform: [{ scale: 0.94 + 0.1 * pulse.get() }],
  }));

  return (
    <Animated.View style={style}>
      <HunchMark size={size} background={background} />
    </Animated.View>
  );
});
