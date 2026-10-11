// Architecture in one frame: iOS app, API, Gemini sandbox, Supabase. Drawn
// with SVG, nodes pop in one after another, no logos.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

type Node = { id: string; x: number; y: number; title: string; sub: string; accent?: boolean };

const W = 1920;
const NODE_W = 340;
const NODE_H = 150;
const ROW_Y = 420;

const nodes: Node[] = [
  { id: "app", x: 120, y: ROW_Y, title: "Hunch iOS app", sub: "Expo Go, swipes, reveals" },
  { id: "api", x: 790, y: ROW_Y, title: "Hunch API", sub: "Next.js route handlers on Vercel", accent: true },
  { id: "gemini", x: 1460, y: ROW_Y, title: "Gemini sandbox", sub: "prediction markets, $1 limit orders" },
  { id: "db", x: 790, y: ROW_Y + 300, title: "Supabase Postgres", sub: "players, swipes, Edge, levels" },
];

type Edge = { from: string; to: string; label: string; offset?: number };
const edges: Edge[] = [
  { from: "app", to: "api", label: "swipe, no odds sent" },
  { from: "api", to: "app", label: "odds and receipt", offset: 1 },
  { from: "api", to: "gemini", label: "signed $1 order" },
  { from: "api", to: "db", label: "every swipe, every score" },
];

const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

export const Diagram = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, Math.round(fps * 0.3)], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fadeIn, fontFamily: fonts.sans }}>
      <div
        style={{
          position: "absolute",
          top: 230,
          width: W,
          textAlign: "center",
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: -0.5,
          color: colors.muted,
        }}
      >
        One builder, one afternoon. Secrets never leave the server.
      </div>
      <svg width={W} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill={colors.muted} />
          </marker>
        </defs>
        {edges.map((edge, i) => {
          const a = byId[edge.from];
          const b = byId[edge.to];
          if (!a || !b) return null;
          const progress = spring({ frame: frame - Math.round(fps * (0.35 + i * 0.12)), fps, config: { damping: 200 } });
          const horizontal = a.y === b.y;
          const lane = (edge.offset ?? 0) * 44 - (horizontal && edges.some((e) => e.from === edge.to && e.to === edge.from) ? 22 : 0);
          let x1: number, y1: number, x2: number, y2: number;
          if (horizontal) {
            const leftToRight = a.x < b.x;
            x1 = leftToRight ? a.x + NODE_W : a.x;
            x2 = leftToRight ? b.x : b.x + NODE_W;
            y1 = y2 = a.y + NODE_H / 2 + lane;
          } else {
            x1 = x2 = a.x + NODE_W / 2;
            y1 = a.y + NODE_H;
            y2 = b.y;
          }
          const xEnd = x1 + (x2 - x1) * progress;
          const yEnd = y1 + (y2 - y1) * progress;
          const labelX = (x1 + x2) / 2;
          const labelY = horizontal ? y1 - 14 + (lane > 0 ? 40 : 0) : (y1 + y2) / 2;
          return (
            <g key={`${edge.from}-${edge.to}`} opacity={progress}>
              <line x1={x1} y1={y1} x2={xEnd} y2={yEnd} stroke={colors.lineStrong} strokeWidth={4} markerEnd="url(#arrow)" />
              <text
                x={horizontal ? labelX : labelX + 18}
                y={labelY}
                fill={colors.muted}
                fontSize={22}
                fontFamily={fonts.sans}
                textAnchor={horizontal ? "middle" : "start"}
                dominantBaseline={horizontal ? "auto" : "middle"}
              >
                {edge.label}
              </text>
            </g>
          );
        })}
        {nodes.map((node, i) => {
          const pop = spring({ frame: frame - Math.round(fps * (0.1 + i * 0.12)), fps, config: { damping: 14, stiffness: 160 } });
          const scale = interpolate(pop, [0, 1], [0.85, 1]);
          const cx = node.x + NODE_W / 2;
          const cy = node.y + NODE_H / 2;
          return (
            <g key={node.id} opacity={pop} transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={28}
                fill={node.accent ? colors.accent : colors.surfaceRaised}
                stroke={node.accent ? colors.accent : colors.lineStrong}
                strokeWidth={3}
              />
              <text
                x={cx}
                y={node.y + 64}
                textAnchor="middle"
                fontFamily={fonts.sans}
                fontWeight={700}
                fontSize={34}
                fill={node.accent ? colors.onAccent : colors.paper}
              >
                {node.title}
              </text>
              <text
                x={cx}
                y={node.y + 106}
                textAnchor="middle"
                fontFamily={fonts.sans}
                fontSize={22}
                fill={node.accent ? colors.onAccent : colors.muted}
              >
                {node.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
