import { useState, useCallback } from "react";
import { Source, DirEntry } from "../types";
import { useApi } from "../services/ApiProvider";

export function useSources() {
  const api = useApi();
  const [sources, setSources] = useState<Source[]>([]);
  const [trees, setTrees] = useState<Record<string, DirEntry>>({});

  const fetchSources = useCallback(async () => {
    try {
      const loadedSources = await api.getSources();
      setSources(loadedSources);
      return loadedSources;
    } catch (err) {
      console.error("Failed to fetch sources:", err);
      return [];
    }
  }, [api]);

  const fetchTree = useCallback(async (path: string) => {
    try {
      const tree: DirEntry = await api.getDirTree(path);
      setTrees(prev => ({ 
        ...prev, 
        [path]: tree
      }));
    } catch (err) {
      console.error(`Failed to fetch tree for ${path}:`, err);
    }
  }, [api]);

  const addSource = useCallback(async (onSourceAdded?: (path: string) => void) => {
    try {
      await api.addSource((path) => {
        fetchSources();
        fetchTree(path);
        if (onSourceAdded) {
          onSourceAdded(path);
        }
      });
    } catch (err) {
      console.error("Failed to add source:", err);
    }
  }, [fetchSources, fetchTree, api]);

  const moveFolder = useCallback(async (srcPath: string, destPath: string) => {
    try {
      const count = await api.moveFolder(srcPath, destPath);
      return count;
    } catch (err) {
      console.error("Failed to move folder:", err);
      throw err;
    }
  }, [api]);

  return {
    sources,
    trees,
    fetchSources,
    fetchTree,
    addSource,
    moveFolder,
  };
}
