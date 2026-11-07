import React, { useState, useMemo, memo } from "react";
import "./Sidebar.css";
import TreeView from "./TreeView";
import { SidebarList } from "./SidebarList";
import { ChevronLeft, Folder, Tag, Users, ChevronsDown, ChevronsUp, Copy, AlertTriangle, Cloud, Bookmark, Sparkles } from "lucide-react";
import { Source, DirEntry, TagWithCount, PersonWithCount, Photo } from "../types";
import { LibraryTab } from "../hooks/useLibraryState";

interface SidebarProps {
  sources: Source[];
  trees: Record<string, DirEntry>;
  onSelectFolder: (path: string) => void;
  selectedPath: string | null;
  onRefreshFolder: (path: string) => void;
  onPhotosDeleted: () => void;
  onAutoRename: (path: string, id?: string) => Promise<number>;
  onMoveFolder?: (node: DirEntry) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  width?: number;
  activeTab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  tags: TagWithCount[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  people: PersonWithCount[];
  selectedPerson: string | null;
  onSelectPerson: (person: string | null) => void;
  isMobile?: boolean;
  photos: Photo[];
  validationFilter: "all" | "missing_event" | "missing_capture_time" | "bad_name" | "bad_folder";
  onValidationFilterChange: (filter: "all" | "missing_event" | "missing_capture_time" | "bad_name" | "bad_folder") => void;
  onFixAllValidationIssues: () => void;
  selectedCount?: number;
}

const Sidebar: React.FC<SidebarProps> = memo(({ 
  sources, 
  trees, 
  onSelectFolder, 
  selectedPath,
  onRefreshFolder,
  onPhotosDeleted,
  onAutoRename,
  onMoveFolder,
  collapsed = false,
  onToggle,
  width = 250,
  activeTab,
  onTabChange,
  tags,
  selectedTag,
  onSelectTag,
  people,
  selectedPerson,
  onSelectPerson,
  isMobile = false,
  photos,
  validationFilter,
  onValidationFilterChange,
  onFixAllValidationIssues,
  selectedCount = 0
}) => {
  const [expandTrigger, setExpandTrigger] = useState(0);
  const [collapseTrigger, setCollapseTrigger] = useState(0);

  const handleExpandAll = () => setExpandTrigger(prev => prev + 1);
  const handleCollapseAll = () => setCollapseTrigger(prev => prev + 1);

  const isToolTab = activeTab === "validation" || activeTab === "duplicates" || activeTab === "icloud" || activeTab === "rank";

  const quickCount = useMemo(() => {
    if (activeTab !== "quick") return 0;
    return photos.filter(p => p.in_quick_collection).length;
  }, [photos, activeTab]);

  const validationCounts = useMemo(() => {
    if (activeTab !== "validation") {
      return { missingEvent: 0, missingCaptureTime: 0, badName: 0, badFolder: 0, total: 0 };
    }
    let missingEvent = 0;
    let missingCaptureTime = 0;
    let badName = 0;
    let badFolder = 0;
    let total = 0;
    for (const p of photos) {
      if (!p.validation_is_valid) total++;
      if (p.validation_issues?.includes("missing_event")) missingEvent++;
      if (p.validation_issues?.includes("missing_capture_time")) missingCaptureTime++;
      if (p.validation_issues?.includes("bad_name")) badName++;
      if (p.validation_issues?.includes("bad_folder")) badFolder++;
    }
    return { missingEvent, missingCaptureTime, badName, badFolder, total };
  }, [photos, activeTab]);

  return (
    <aside 
      className={`sidebar ${collapsed ? "collapsed" : ""} ${isMobile ? "is-mobile" : ""}`}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="sidebar-header">
        {isToolTab ? (
          <div className="sidebar-tool-header">
            {activeTab === "validation" && (
              <>
                <AlertTriangle size={18} className="tool-header-icon" />
                <span className="tool-header-title">Validation</span>
              </>
            )}
            {activeTab === "duplicates" && (
              <>
                <Copy size={18} className="tool-header-icon" />
                <span className="tool-header-title">Duplicates</span>
              </>
            )}
            {activeTab === "icloud" && (
              <>
                <Cloud size={18} className="tool-header-icon" />
                <span className="tool-header-title">iCloud Sync</span>
              </>
            )}
            {activeTab === "rank" && (
              <>
                <Sparkles size={18} className="tool-header-icon" />
                <span className="tool-header-title">Photo Ranker</span>
              </>
            )}
          </div>
        ) : (
          <div className="sidebar-tabs">
            <button 
              className={`tab-btn ${activeTab === "folders" ? "active" : ""}`}
              onClick={() => onTabChange("folders")}
              title="Folders"
            >
              <Folder size={18} />
            </button>
            <button 
              className={`tab-btn ${activeTab === "tags" ? "active" : ""}`}
              onClick={() => onTabChange("tags")}
              title="Tags"
            >
              <Tag size={18} />
            </button>
            <button 
              className={`tab-btn ${activeTab === "people" ? "active" : ""}`}
              onClick={() => onTabChange("people")}
              title="People"
            >
              <Users size={18} />
            </button>
            <button 
              className={`tab-btn ${activeTab === "quick" ? "active" : ""}`}
              onClick={() => onTabChange("quick")}
              title="Quick Collection"
            >
              <Bookmark size={18} />
            </button>
          </div>
        )}
        <div className="sidebar-header-actions">
          {activeTab === "folders" && (
            <>
              <button className="add-source-btn" onClick={handleExpandAll} title="Expand All">
                <ChevronsDown size={16} />
              </button>
              <button className="add-source-btn" onClick={handleCollapseAll} title="Collapse All">
                <ChevronsUp size={16} />
              </button>
            </>
          )}
          {!isMobile && (
            <button className="panel-toggle" onClick={onToggle} title="Collapse Sidebar">
              <ChevronLeft size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="sidebar-content">
        {activeTab === "folders" ? (
          <>
            {sources.map((source) => (
              <div key={source.id} className="source-group">
                {trees[source.path] ? (
                  <TreeView 
                    node={trees[source.path]} 
                    onSelect={onSelectFolder} 
                    selectedPath={selectedPath}
                    onRefresh={onRefreshFolder}
                    onPhotosDeleted={onPhotosDeleted}
                    onAutoRename={onAutoRename}
                    onMoveFolder={onMoveFolder}
                    isSourceRoot={true}
                    expandTrigger={expandTrigger}
                    collapseTrigger={collapseTrigger}
                  />
                ) : (
                  <div className="source-loading">Loading tree...</div>
                )}
              </div>
            ))}
            {sources.length === 0 && (
              <div className="empty-sources">
                No sources added.
              </div>
            )}
          </>
        ) : activeTab === "tags" ? (
          <SidebarList 
            items={tags} 
            selectedItem={selectedTag} 
            onSelectItem={onSelectTag} 
            icon={Tag}
            allLabel="All Photos"
            emptyMessage="No tags found."
          />
        ) : activeTab === "people" ? (
          <SidebarList 
            items={people} 
            selectedItem={selectedPerson} 
            onSelectItem={onSelectPerson} 
            icon={Users}
            allLabel="All People"
            emptyMessage="No people found."
          />
        ) : activeTab === "quick" ? (
          <div className="quick-collection-sidebar" style={{ padding: "16px" }}>
            <div className="quick-collection-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--text-color, #fff)" }}>Quick Collection</h3>
              <span className="filter-count" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", padding: "2px 8px", borderRadius: "12px", fontSize: "12px" }}>{quickCount}</span>
            </div>
            <p style={{ color: "var(--text-muted, #888)", fontSize: "13px", lineHeight: "1.5" }}>
              Press <strong>B</strong> on any photo in the grid to add or remove it from your Quick Collection.
            </p>
          </div>
        ) : activeTab === "validation" ? (
          <div className="validation-sidebar">
            <div className="validation-info">
              <p>Detect and resolve organization and naming issues in your library.</p>
            </div>
            
            <div className="validation-filters-list">
              <button
                className={`validation-filter-item ${validationFilter === "all" ? "active" : ""}`}
                onClick={() => onValidationFilterChange("all")}
              >
                <span className="filter-label">All Issues</span>
                <span className="filter-count">{validationCounts.total}</span>
              </button>
              
              <button
                className={`validation-filter-item ${validationFilter === "missing_event" ? "active" : ""}`}
                onClick={() => onValidationFilterChange("missing_event")}
              >
                <span className="filter-label">Missing Event</span>
                <span className="filter-count">{validationCounts.missingEvent}</span>
              </button>

              <button
                className={`validation-filter-item ${validationFilter === "missing_capture_time" ? "active" : ""}`}
                onClick={() => onValidationFilterChange("missing_capture_time")}
              >
                <span className="filter-label">Missing Capture Time</span>
                <span className="filter-count">{validationCounts.missingCaptureTime}</span>
              </button>

              <button
                className={`validation-filter-item ${validationFilter === "bad_name" ? "active" : ""}`}
                onClick={() => onValidationFilterChange("bad_name")}
              >
                <span className="filter-label">Incorrect Name</span>
                <span className="filter-count">{validationCounts.badName}</span>
              </button>

              <button
                className={`validation-filter-item ${validationFilter === "bad_folder" ? "active" : ""}`}
                onClick={() => onValidationFilterChange("bad_folder")}
              >
                <span className="filter-label">Incorrect Folder</span>
                <span className="filter-count">{validationCounts.badFolder}</span>
              </button>
            </div>

            {validationCounts.total > 0 && (
              <div className="validation-actions">
                <button 
                  className="fix-issues-btn" 
                  onClick={onFixAllValidationIssues}
                >
                  {selectedCount > 0 ? "Fix Selected Issues" : "Fix All Issues"}
                </button>
              </div>
            )}
          </div>
        ) : activeTab === "icloud" ? (
          <div className="icloud-sidebar" style={{ padding: "16px", color: "var(--text-muted, #888)", fontSize: "13px", lineHeight: "1.5" }}>
            <p>Compare your iCloud Photos library against DamRight to clean up rejected and deleted photos from the cloud.</p>
          </div>
        ) : activeTab === "rank" ? (
          <div className="rank-sidebar" style={{ padding: "16px", color: "var(--text-muted, #888)", fontSize: "13px", lineHeight: "1.5" }}>
            <p style={{ fontWeight: 600, color: "#eee", marginBottom: "8px" }}>Photo Force Ranker</p>
            <p>Vote for your preferred photo to refine Elo ratings and compute suggested star ratings across your library.</p>
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
              <div><strong style={{ color: "#aaa" }}>Best of 4:</strong> Keys 1, 2, 3, 4 to vote</div>
              <div><strong style={{ color: "#aaa" }}>1 vs 1:</strong> Keys 1 (Left), 2 (Right), T (Tie)</div>
              <div><strong style={{ color: "#aaa" }}>Space / S:</strong> Skip</div>
            </div>
          </div>
        ) : (
          <div className="duplicates-info">
            <p>Compare duplicate photos side by side with key metadata and delete redundant copies.</p>
          </div>
        )}
      </div>
    </aside>
  );
});

export default Sidebar;
