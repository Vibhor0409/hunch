// The Hunch mark as a React Native SVG: a tilted slip with a perforated stub.
// Same geometry as assets/images/mark.svg. The notches and perforation take the
// color of whatever the mark sits on, so it reads as cut paper.

import { memo } from "react";
import Svg, { Circle, G, Line, Rect } from "react-native-svg";

import { colors } from "@/lib/theme";

export const HunchMark = memo(function HunchMark({
  size = 96,
  background = colors.paper,
  fill = colors.accent,
}: {
  size?: number;
  background?: string;
  fill?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <G transform="rotate(-9 512 512)">
        <Rect x={232} y={152} width={560} height={720} rx={64} fill={fill} />
        <Circle cx={232} cy={642} r={46} fill={background} />
        <Circle cx={792} cy={642} r={46} fill={background} />
        <Line x1={315} y1={642} x2={709} y2={642} stroke={background} strokeWidth={16} strokeDasharray="30 22" />
      </G>
    </Svg>
  );
});
