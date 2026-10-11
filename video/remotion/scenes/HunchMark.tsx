// The Hunch mark, same geometry as mobile/assets/images/mark.svg (the app
// icon): a slip tilted 9 degrees with two notches and a perforated stub.
// Amber on the dark base. Original work, nothing borrowed.
export const HunchMark = ({ size = 160, color = "#FFB224", bg = "#0B0B0F" }: { size?: number; color?: string; bg?: string }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" aria-label="Hunch">
      <g transform="rotate(-9 512 512)">
        <rect x="232" y="152" width="560" height="720" rx="64" fill={color} />
        <circle cx="232" cy="642" r="46" fill={bg} />
        <circle cx="792" cy="642" r="46" fill={bg} />
        <line x1="315" y1="642" x2="709" y2="642" stroke={bg} strokeWidth="16" strokeDasharray="30 22" />
      </g>
    </svg>
  );
};
