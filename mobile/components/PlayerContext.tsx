// Who is playing on this device. Set once on Join, read everywhere.

import { createContext, useContext } from "react";

export interface PlayerContextValue {
  playerId: string | null;
  setPlayerId: (playerId: string | null) => void;
}

export const PlayerContext = createContext<PlayerContextValue>({
  playerId: null,
  setPlayerId: () => {},
});

export function usePlayer(): PlayerContextValue {
  return useContext(PlayerContext);
}
