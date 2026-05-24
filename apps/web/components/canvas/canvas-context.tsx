'use client';

import { createContext, useContext } from 'react';

interface CanvasContextValue {
  orgId: string;
  siteGroupId: string;
}

const CanvasContext = createContext<CanvasContextValue>({
  orgId: '',
  siteGroupId: '',
});

export function CanvasContextProvider({
  orgId,
  siteGroupId,
  children,
}: CanvasContextValue & { children: React.ReactNode }) {
  return (
    <CanvasContext.Provider value={{ orgId, siteGroupId }}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvasContext(): CanvasContextValue {
  return useContext(CanvasContext);
}
