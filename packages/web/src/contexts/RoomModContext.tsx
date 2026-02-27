import { createContext, useContext } from 'react';

interface RoomModState {
  roomUri?: string;
  roomOwnerDid?: string;
  isCurrentUserOwner: boolean;
  isCurrentUserOwnerOrMod: boolean;
}

const defaultState: RoomModState = {
  isCurrentUserOwner: false,
  isCurrentUserOwnerOrMod: false,
};

export const RoomModContext = createContext<RoomModState>(defaultState);

export function useRoomMod(): RoomModState {
  return useContext(RoomModContext);
}
