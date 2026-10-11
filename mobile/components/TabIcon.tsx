// Hunch's own tab glyphs, drawn with react-native-svg. No icon font, no brand lookalikes.

import type { ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type TabIconName = "deck" | "leaderboard" | "me";

export function TabIcon({ name, color: rawColor, size = 24 }: { name: TabIconName; color: ColorValue; size?: number }) {
  const color = String(rawColor);
  switch (name) {
    case "deck":
      // Two slips, the back one tilted.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="7.5" y="3" width="11" height="15" rx="2.5" stroke={color} strokeWidth="1.8" transform="rotate(9 13 10.5)" opacity={0.55} />
          <Rect x="5" y="5.5" width="11" height="15" rx="2.5" fill={color} />
        </Svg>
      );
    case "leaderboard":
      // Three bars, the middle one tallest.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="3" y="12" width="5" height="9" rx="1.5" fill={color} opacity={0.55} />
          <Rect x="9.5" y="4" width="5" height="17" rx="1.5" fill={color} />
          <Rect x="16" y="9" width="5" height="12" rx="1.5" fill={color} opacity={0.55} />
        </Svg>
      );
    case "me":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="8" r="4.2" fill={color} />
          <Path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        </Svg>
      );
  }
}
