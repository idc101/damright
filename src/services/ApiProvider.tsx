import React, { createContext, useContext, useMemo } from "react";
import { ApiService } from "./api";
import { TauriApiService } from "./tauriApiService";
import { HttpApiService } from "./httpApiService";

const ApiContext = createContext<ApiService | null>(null);

export const ApiProvider: React.FC<{ children: React.ReactNode; service?: ApiService }> = ({ children, service }) => {
  const api = useMemo(() => {
    if (service) return service;
    // Check if we are running in Tauri
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    return isTauri ? new TauriApiService() : new HttpApiService();
  }, [service]);

  return (
    <ApiContext.Provider value={api}>
      {children}
    </ApiContext.Provider>
  );
};

export const useApi = () => {
  const context = useContext(ApiContext);
  if (!context) {
    throw new Error("useApi must be used within an ApiProvider");
  }
  return context;
};
