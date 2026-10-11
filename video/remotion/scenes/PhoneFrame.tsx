// An iPhone-shaped frame drawn in code: a rounded rectangle with a thin bezel.
// Not Apple's device artwork. The children fill the screen area.
import type { CSSProperties, ReactNode } from "react";
import { colors, layout } from "../theme";

export const phoneOuterSize = () => {
  const { screenWidth, screenHeight, bezel } = layout.phone;
  return { width: screenWidth + bezel * 2, height: screenHeight + bezel * 2 };
};

export const PhoneFrame = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => {
  const { screenWidth, screenHeight, bezel, radius } = layout.phone;
  const outer = phoneOuterSize();
  return (
    <div
      style={{
        position: "absolute",
        left: (layout.width - outer.width) / 2,
        top: layout.phone.top,
        width: outer.width,
        height: outer.height,
        borderRadius: radius,
        background: "#07070A",
        boxShadow: `0 0 0 2px ${colors.lineStrong}, 0 40px 120px rgba(0,0,0,0.6), 0 0 160px ${colors.accentSoft}`,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: bezel,
          top: bezel,
          width: screenWidth,
          height: screenHeight,
          borderRadius: radius - bezel,
          overflow: "hidden",
          background: colors.bg,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Soft amber glow behind the phone. Drawn by the composition under the overlays. */
export const PhoneGlow = () => (
  <div
    style={{
      position: "absolute",
      left: layout.width / 2 - 520,
      top: layout.height / 2 - 520,
      width: 1040,
      height: 1040,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${colors.accentSoft} 0%, rgba(11,11,15,0) 62%)`,
    }}
  />
);
