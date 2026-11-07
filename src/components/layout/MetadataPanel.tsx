import { useState } from "react";
import { Info, X, ChevronRight, Settings2 } from "lucide-react";
import { Photo, Source } from "../../types";
import { MetadataInspectSection } from "./MetadataInspectSection";
import { MetadataEditSection } from "./MetadataEditSection";
import "./MetadataPanel.css";

interface MetadataPanelProps {
  photo: Photo | null;
  selectedCount: number;
  updateExposure: (id: string, val: number) => void;
  updatePortraitBlur?: (id: string, val: number) => void;
  updateMetadata: (id: string, rating: number, tags: string, title: string, description: string) => void;
  updateCrop: (id: string, top: number | null, left: number | null, bottom: number | null, right: number | null, angle: number | null) => void;
  onEnterCropMode?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
  onEditTags?: () => void;
  onEditDate?: () => void;
  width?: number;
  isMobile?: boolean;
  sources?: Source[];
}

type TabType = 'metadata' | 'edit';

export function MetadataPanel({
  photo,
  selectedCount,
  updateExposure,
  updatePortraitBlur,
  updateMetadata,
  updateCrop,
  onEnterCropMode,
  collapsed = false,
  onToggle,
  onEditTags,
  onEditDate,
  width = 350,
  isMobile = false,
  sources
}: MetadataPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('metadata');

  const containerStyle = isMobile ? { width: '100%' } : { width: collapsed ? 0 : width };

  if (!photo) {
    return (
      <aside className={`details-panel ${collapsed ? "collapsed" : ""}`} style={containerStyle}>
        {!collapsed && (
          <>
            <div className="detail-header">
              <div className="header-title-group">
                <h3><Info size={18} /> Info</h3>
              </div>
              <button className="panel-toggle" onClick={onToggle} title={isMobile ? "Close" : "Collapse Panel"}>
                {isMobile ? <X size={20} /> : <ChevronRight size={16} />}
              </button>
            </div>
            <div className="no-selection">
              {selectedCount > 0 
                ? (
                  <div className="batch-selection-info">
                    <p>{selectedCount} items selected</p>
                  </div>
                )
                : "Select a photo to view details"
              }
            </div>
          </>
        )}
      </aside>
    );
  }

  return (
    <aside className={`details-panel ${collapsed ? "collapsed" : ""}`} style={containerStyle}>
      {!collapsed && (
        <>
          <div className="detail-header">
            <div className="header-title-group">
              <div className="sidebar-tabs metadata-tabs">
                <button 
                  className={`tab-btn ${activeTab === 'metadata' ? 'active' : ''}`}
                  onClick={() => setActiveTab('metadata')}
                  title="Metadata & Info"
                >
                  <Info size={18} />
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
                  onClick={() => setActiveTab('edit')}
                  title="Edit Adjustments"
                >
                  <Settings2 size={18} />
                </button>
              </div>
              {selectedCount > 1 && (
                <span className="selection-count">{selectedCount} selected</span>
              )}
            </div>
            <button className="panel-toggle" onClick={onToggle} title={isMobile ? "Close" : "Collapse Panel"}>
              {isMobile ? <X size={20} /> : <ChevronRight size={16} />}
            </button>
          </div>

          <div className="panel-scroll-content">
            {activeTab === 'metadata' ? (
              <MetadataInspectSection
                photo={photo}
                updateMetadata={updateMetadata}
                onEditTags={onEditTags}
                onEditDate={onEditDate}
                sources={sources}
              />
            ) : (
              <MetadataEditSection
                photo={photo}
                updateExposure={updateExposure}
                updatePortraitBlur={updatePortraitBlur}
                updateCrop={updateCrop}
                onEnterCropMode={onEnterCropMode}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
