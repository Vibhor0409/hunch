// Hunch's own mark, drawn here: a card mid-swipe with a blind dot. Original
// artwork for the video; nothing borrowed from Gemini or anyone else.
export const HunchMark = ({ size = 160, color = "#FFB224", paper = "#F3F1EA" }: { size?: number; color?: string; paper?: string }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-label="Hunch">
      {/* back card, resting */}
      <rect x="44" y="30" width="80" height="112" rx="18" stroke={paper} strokeOpacity="0.28" strokeWidth="6" transform="rotate(7 84 86)" />
      {/* front card, tilted as a swipe commits */}
      <rect x="36" y="24" width="80" height="112" rx="18" fill={color} transform="rotate(-11 76 80)" />
      {/* the blind dot: the odds you have not seen yet */}
      <circle cx="76" cy="64" r="11" fill="#16120A" transform="rotate(-11 76 80)" />
      {/* the call line */}
      <rect x="54" y="96" width="44" height="10" rx="5" fill="#16120A" transform="rotate(-11 76 80)" />
    </svg>
  );
};
