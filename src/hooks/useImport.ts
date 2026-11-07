import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Photo, Progress } from "../types";
import { useApi } from "../services/ApiProvider";

export function useImport(onPhotosImported: (newPhotos: Photo[]) => void) {
  const api = useApi();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    let lastUpdate = 0;
    const unlisten = listen<Progress>("import-progress", (event) => {
      const now = Date.now();
      // Throttle updates to every 100ms to prevent UI jumping, 
      // but always allow the final update (100%)
      if (now - lastUpdate > 100 || event.payload.current === event.payload.total) {
        setProgress(event.payload);
        lastUpdate = now;
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const importFolder = useCallback(async (folderPath: string) => {
    setImporting(true);
    setProgress({ message: "Scanning folder...", current: 0, total: 0 });
    try {
      const imported: Photo[] = await api.refreshFolder(folderPath);
      onPhotosImported(imported);
    } catch (err) {
      console.error("Import error:", err);
      alert("Import failed: " + err);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [onPhotosImported, api]);

  const refreshFolder = useCallback(async (folderPath: string) => {
    setImporting(true);
    setProgress({ message: "Refreshing folder...", current: 0, total: 0 });
    try {
      const refreshed: Photo[] = await api.refreshFolder(folderPath);
      onPhotosImported(refreshed);
    } catch (err) {
      console.error("Refresh error:", err);
      alert("Refresh failed: " + err);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [onPhotosImported, api]);


  return {
    importing,
    progress,
    importFolder,
    refreshFolder,
  };
}
