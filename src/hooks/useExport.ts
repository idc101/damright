import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Progress } from "../types";
import { useApi } from "../services/ApiProvider";
import { ExportConfig } from "../components/common/ExportModal";

export function useExport() {
  const api = useApi();
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<Progress | null>(null);

  useEffect(() => {
    let lastUpdate = 0;
    const unlisten = listen<Progress>("export-progress", (event) => {
      const now = Date.now();
      if (now - lastUpdate > 100 || event.payload.current === event.payload.total) {
        setExportProgress(event.payload);
        lastUpdate = now;
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const exportPhotos = useCallback(async (config: ExportConfig) => {
    setExporting(true);
    setExportProgress({ message: "Preparing export...", current: 0, total: config.photo_ids.length });
    try {
      const count = await api.exportPhotos(config);
      return count;
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }, [api]);

  return {
    exporting,
    exportProgress,
    exportPhotos,
  };
}
