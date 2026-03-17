import { createContext, useContext } from 'react';

type ViewProfileFn = ((did: string) => void) | undefined;

const ViewProfileContext = createContext<ViewProfileFn>(undefined);

export const ViewProfileProvider = ViewProfileContext.Provider;

export function useViewProfile(): ViewProfileFn {
  return useContext(ViewProfileContext);
}
