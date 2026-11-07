import React from "react";
import { X } from "lucide-react";
import "./TagPill.css";

interface TagPillProps {
  tag: string;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
  isPartial?: boolean;
}

export const TagPill: React.FC<TagPillProps> = ({ tag, onRemove, onClick, className = "", isPartial = false }) => {
  return (
    <div 
      className={`tag-pill ${className} ${onClick ? 'clickable' : ''} ${isPartial ? 'partial' : ''}`} 
      onClick={onClick}
      title={isPartial ? "Present on some photos. Click to apply to all." : undefined}
    >
      <span className="tag-text">{tag}</span>
      {isPartial && <span className="partial-indicator">(some)</span>}
      {onRemove && (
        <button 
          className="tag-remove" 
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={`Remove ${tag}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};
