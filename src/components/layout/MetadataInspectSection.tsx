import { useState, useEffect } from "react";
import { Star, Edit2, FileText, Check, Users, MapPin, Copy, Tag as TagIcon, Sparkles } from "lucide-react";
import { Photo, Source } from "../../types";
import { TagPill } from "../common/TagPill";
import { getPathParts, getRelativeFolderPath, getRelativeFilePath } from "../../utils/pathUtils";

interface MetadataInspectSectionProps {
  photo: Photo;
  updateMetadata: (id: string, rating: number, tags: string, title: string, description: string) => void;
  onEditTags?: () => void;
  onEditDate?: () => void;
  sources?: Source[];
}

const formatFileSize = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null) return "Unknown";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(1)} MB`;
};

export function MetadataInspectSection({
  photo,
  updateMetadata,
  onEditTags,
  onEditDate,
  sources,
}: MetadataInspectSectionProps) {
  const isVideo = photo.mime_type?.startsWith("video/") || /\.(mp4|mov|m4v|mkv|avi|webm)$/i.test(photo.path);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [copiedFolderSuccess, setCopiedFolderSuccess] = useState(false);
  const [copiedFileSuccess, setCopiedFileSuccess] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [tempDesc, setTempDesc] = useState("");

  useEffect(() => {
    setCopiedFolderSuccess(false);
    setCopiedFileSuccess(false);
    setShowFolderMenu(false);
    setShowFileMenu(false);
  }, [photo]);

  useEffect(() => {
    const handleClickOutside = () => {
      setShowFolderMenu(false);
      setShowFileMenu(false);
    };
    if (showFolderMenu || showFileMenu) {
      window.addEventListener("click", handleClickOutside);
    }
    return () => window.removeEventListener("click", handleClickOutside);
  }, [showFolderMenu, showFileMenu]);

  const handleCopyText = (text: string, type: 'folder' | 'file') => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'folder') {
        setCopiedFolderSuccess(true);
        setTimeout(() => setCopiedFolderSuccess(false), 1500);
      } else {
        setCopiedFileSuccess(true);
        setTimeout(() => setCopiedFileSuccess(false), 1500);
      }
    });
  };

  const handleCopyOption = (option: 'abs-folder' | 'rel-folder' | 'filename' | 'abs-file' | 'rel-file') => {
    const { folder, filename } = getPathParts(photo.path);
    let textToCopy = "";
    let type: 'folder' | 'file' = 'folder';
    
    switch (option) {
      case 'abs-folder':
        textToCopy = folder;
        type = 'folder';
        break;
      case 'rel-folder':
        textToCopy = getRelativeFolderPath(photo.path, sources);
        type = 'folder';
        break;
      case 'filename':
        textToCopy = filename;
        type = 'file';
        break;
      case 'abs-file':
        textToCopy = photo.path;
        type = 'file';
        break;
      case 'rel-file':
        textToCopy = getRelativeFilePath(photo.path, sources);
        type = 'file';
        break;
    }
    
    handleCopyText(textToCopy, type);
    setShowFolderMenu(false);
    setShowFileMenu(false);
  };

  const handleTitleSave = () => {
    updateMetadata(photo.id, photo.rating, photo.tags, tempTitle, photo.description || "");
    setEditingTitle(false);
  };

  const handleDescSave = () => {
    updateMetadata(photo.id, photo.rating, photo.tags, photo.title || "", tempDesc);
    setEditingDesc(false);
  };

  return (
    <>
      <div className="panel-section">
        <h3>Metadata</h3>
        <div className="control-group">
          <label>Manual Rating</label>
          <div className="rating-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={20}
                className={star <= photo.rating ? "star-filled" : "star-empty"}
                onClick={() => updateMetadata(photo.id, star, photo.tags, photo.title || "", photo.description || "")}
              />
            ))}
          </div>
          {photo.suggested_rating !== undefined && photo.suggested_rating > 0 && !isVideo && (
            <div className="suggested-rating-group" data-testid="suggested-rating-group">
              <div className="suggested-rating-display">
                <div className="suggested-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={14}
                      className={star <= (photo.suggested_rating || 0) ? "suggested-star-filled" : "suggested-star-empty"}
                    />
                  ))}
                </div>
                <span className="suggested-meta-info" title={`Elo: ${photo.rank_score ?? 1500}, Matches: ${photo.match_count ?? 0}`}>
                  <Sparkles size={12} />
                  Suggested ({photo.suggested_rating ?? 0}★{photo.match_count ? `, ${photo.match_count} duels` : ""})
                </span>
              </div>
              {photo.suggested_rating !== photo.rating && (
                <button
                  className="text-button-small"
                  onClick={() => updateMetadata(photo.id, photo.suggested_rating ?? 0, photo.tags, photo.title || "", photo.description || "")}
                  title="Accept suggested rating"
                  data-testid="apply-suggested-rating-btn"
                >
                  Apply
                </button>
              )}
            </div>
          )}
        </div>
        <div className="control-group">
          <label className="label-with-action">
            <span><TagIcon size={16} /> Tags</span>
            <button className="text-button-small" onClick={onEditTags} title="Edit Tags">
              <Edit2 size={12} /> Edit...
            </button>
          </label>
          <div className="tag-pills-container">
            {photo.tags ? photo.tags.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => (
              <TagPill key={tag} tag={tag} />
            )) : (
              <span className="no-tags-found">No tags</span>
            )}
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3><FileText size={18} /> Text Info</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!editingTitle && !photo.title && (
              <button className="text-button-small" onClick={() => setEditingTitle(true)} title="Add Title">
                + Title
              </button>
            )}
            {!editingDesc && !photo.description && (
              <button className="text-button-small" onClick={() => setEditingDesc(true)} title="Add Description">
                + Desc
              </button>
            )}
          </div>
        </div>

        {(photo.title || editingTitle) && (
          <div className="control-group">
            <label className="label-with-action">
              Title
              {!editingTitle ? (
                <button className="text-button-small" onClick={() => setEditingTitle(true)}>
                  <Edit2 size={12} /> Edit
                </button>
              ) : (
                <button className="text-button-small success" onClick={handleTitleSave}>
                  <Check size={12} /> Save
                </button>
              )}
            </label>
            {editingTitle ? (
              <input 
                type="text" 
                className="edit-input"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
                autoFocus
              />
            ) : (
              <p className="display-text title-text">
                {photo.title}
              </p>
            )}
          </div>
        )}

        {(photo.description || editingDesc) && (
          <div className="control-group">
            <label className="label-with-action">
              Description
              {!editingDesc ? (
                <button className="text-button-small" onClick={() => setEditingDesc(true)}>
                  <Edit2 size={12} /> Edit
                </button>
              ) : (
                <button className="text-button-small success" onClick={handleDescSave}>
                  <Check size={12} /> Save
                </button>
              )}
            </label>
            {editingDesc ? (
              <textarea 
                className="edit-textarea"
                value={tempDesc}
                onChange={(e) => setTempDesc(e.target.value)}
                onBlur={handleDescSave}
                autoFocus
              />
            ) : (
              <div className="description-box">
                <p>{photo.description}</p>
              </div>
            )}
          </div>
        )}
        
        {!photo.title && !photo.description && !editingTitle && !editingDesc && (
          <p className="empty-info-hint">No text metadata set</p>
        )}
      </div>

      {photo.faces && photo.faces.length > 0 && (
        <div className="panel-section">
          <h3>
            <Users size={18} /> People
          </h3>
          <div className="people-list">
            {photo.faces.map((face, i) => (
              <div key={i} className="person-tag" title={face.area_x ? `Location: ${Math.round(face.area_x * 100)}%, ${Math.round(face.area_y! * 100)}%` : undefined}>
                {face.name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel-section info">
        <div className="section-header">
          <h3>File Info</h3>
        </div>
        <p>
          <strong>Dimensions:</strong> {photo.width && photo.height ? `${photo.width} × ${photo.height}` : "Unknown"}
        </p>
        {photo.capture_time && (
          <p className="label-with-action">
            <strong>Date:</strong> {photo.capture_time}
            <button className="text-button-small" onClick={onEditDate} title="Edit Date">
              <Edit2 size={12} /> Edit
            </button>
          </p>
        )}
        <p>
          <strong>Size:</strong> {formatFileSize(photo.file_size)}
        </p>
        <p>
          <strong>Camera:</strong> {photo.camera_make || photo.camera_model ? `${photo.camera_make || ""} ${photo.camera_model || ""}`.trim() : "Unknown"}
        </p>
        {photo.latitude != null && photo.longitude != null && (
          <p>
            <strong>GPS:</strong> {photo.latitude.toFixed(4)}, {photo.longitude.toFixed(4)}
          </p>
        )}
        {[photo.location_name, photo.city, photo.state, photo.country].some(Boolean) && (
          <p>
            <strong>Location:</strong> <MapPin size={12} className="inline-icon" /> {[photo.location_name, photo.city, photo.state, photo.country].filter(Boolean).join(", ")}
          </p>
        )}
        <p>
          <strong>Type:</strong> {photo.mime_type}
        </p>
        {photo.path && (() => {
          const { folder, filename } = getPathParts(photo.path);
          const relativeFolder = getRelativeFolderPath(photo.path, sources);
          return (
            <>
              <div className="path-detail-row">
                <strong>Folder:</strong>{" "}
                <span className="path-text" title={folder}>{relativeFolder}</span>
                <div className="copy-dropdown-container">
                  <button
                    className={`copy-btn ${copiedFolderSuccess ? 'copied' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFolderMenu(!showFolderMenu);
                      setShowFileMenu(false);
                    }}
                    title="Copy folder path options"
                  >
                    {copiedFolderSuccess ? <Check size={12} className="success-icon" /> : <Copy size={12} />}
                  </button>
                  {showFolderMenu && (
                    <div className="copy-dropdown-menu">
                      <button onClick={() => handleCopyOption('abs-folder')}>Absolute Folder Path</button>
                      <button onClick={() => handleCopyOption('rel-folder')}>Relative Folder Path</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="path-detail-row">
                <strong>Filename:</strong>{" "}
                <span className="path-text" title={photo.path}>{filename}</span>
                <div className="copy-dropdown-container">
                  <button
                    className={`copy-btn ${copiedFileSuccess ? 'copied' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFileMenu(!showFileMenu);
                      setShowFolderMenu(false);
                    }}
                    title="Copy filename options"
                  >
                    {copiedFileSuccess ? <Check size={12} className="success-icon" /> : <Copy size={12} />}
                  </button>
                  {showFileMenu && (
                    <div className="copy-dropdown-menu">
                      <button onClick={() => handleCopyOption('filename')}>Filename</button>
                      <button onClick={() => handleCopyOption('abs-file')}>Absolute File Path</button>
                      <button onClick={() => handleCopyOption('rel-file')}>Relative File Path</button>
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </>
  );
}
