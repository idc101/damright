import React, { useState, useMemo } from 'react';
import { Search, Plus, Check } from 'lucide-react';
import { Modal } from './Modal';
import { TagPill } from './TagPill';
import { TagWithCount } from '../../types';
import './TagModal.css';

interface TagModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTags: TagWithCount[];
  initialTags: string[];
  partialTags?: string[];
  onSave: (tags: string[], delta?: { added: string[]; removed: string[] }) => void;
  selectedCount: number;
}

export const TagModal: React.FC<TagModalProps> = ({
  isOpen,
  onClose,
  allTags = [],
  initialTags = [],
  partialTags = [],
  onSave,
  selectedCount
}) => {
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [currentPartialTags, setCurrentPartialTags] = useState<string[]>(partialTags);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset selected tags and partial tags when modal opens with new initial tags
  React.useEffect(() => {
    if (isOpen) {
      setSelectedTags(initialTags);
      setCurrentPartialTags(partialTags);
      setSearchQuery('');
    }
  }, [isOpen, initialTags, partialTags]);

  const filteredSuggestions = useMemo(() => {
    const selectedLower = new Set(selectedTags.map(t => t.toLowerCase()));
    const partialLower = new Set(currentPartialTags.map(t => t.toLowerCase()));
    const query = searchQuery.trim().toLowerCase();

    return allTags
      .filter(t => {
        const nameLower = t.name.toLowerCase();
        const matchesQuery = !query || nameLower.includes(query);
        const isEligible = !selectedLower.has(nameLower) || partialLower.has(nameLower);
        return matchesQuery && isEligible;
      })
      .slice(0, 20);
  }, [allTags, searchQuery, selectedTags, currentPartialTags]);

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;

    const existing = selectedTags.find(t => t.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (currentPartialTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
        setCurrentPartialTags(prev => prev.filter(t => t.toLowerCase() !== trimmed.toLowerCase()));
      }
    } else {
      setSelectedTags(prev => [...prev, trimmed]);
    }
    setSearchQuery('');
  };

  const handleTagClick = (tag: string) => {
    if (currentPartialTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      setCurrentPartialTags(prev => prev.filter(t => t.toLowerCase() !== tag.toLowerCase()));
    }
  };

  const handleRemoveTag = (tag: string) => {
    setSelectedTags(prev => prev.filter(t => t.toLowerCase() !== tag.toLowerCase()));
    setCurrentPartialTags(prev => prev.filter(t => t.toLowerCase() !== tag.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      handleAddTag(searchQuery);
    }
  };

  const handleApply = () => {
    const initialLowerSet = new Set(initialTags.map(t => t.toLowerCase()));
    const initialPartialLowerSet = new Set(partialTags.map(t => t.toLowerCase()));
    const currentPartialLowerSet = new Set(currentPartialTags.map(t => t.toLowerCase()));

    const added: string[] = [];
    for (const tag of selectedTags) {
      const lower = tag.toLowerCase();
      if (!initialLowerSet.has(lower)) {
        added.push(tag);
      } else if (initialPartialLowerSet.has(lower) && !currentPartialLowerSet.has(lower)) {
        added.push(tag);
      }
    }

    const currentSelectedLowerSet = new Set(selectedTags.map(t => t.toLowerCase()));
    const removed: string[] = [];
    for (const tag of initialTags) {
      const lower = tag.toLowerCase();
      if (!currentSelectedLowerSet.has(lower)) {
        removed.push(tag);
      }
    }

    onSave(selectedTags, { added, removed });
  };

  const footer = (
    <>
      <button className="secondary-button" onClick={onClose}>Cancel</button>
      <button className="primary-button" onClick={handleApply}>
        <Check size={16} /> Apply to {selectedCount} {selectedCount === 1 ? 'Photo' : 'Photos'}
      </button>
    </>
  );

  return (
    <Modal
      title="Edit Tags"
      isOpen={isOpen}
      onClose={onClose}
      footer={footer}
    >
      <div className="tag-modal-content">
        <div className="current-tags-section">
          <h4>Selected Tags</h4>
          <div className="tag-pills-container">
            {selectedTags.map(tag => {
              const isPartial = currentPartialTags.some(t => t.toLowerCase() === tag.toLowerCase());
              return (
                <TagPill 
                  key={tag} 
                  tag={tag} 
                  isPartial={isPartial}
                  onClick={() => handleTagClick(tag)}
                  onRemove={() => handleRemoveTag(tag)} 
                />
              );
            })}
            {selectedTags.length === 0 && (
              <span className="no-tags-found">No tags selected</span>
            )}
          </div>
        </div>

        <div className="search-tags-section">
          <h4>Add Tags</h4>
          <div className="tag-search-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search or add new tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="tag-search-results">
            {searchQuery && !allTags.some(t => t.name.toLowerCase() === searchQuery.trim().toLowerCase()) && (
              <div className="new-tag-hint" onClick={() => handleAddTag(searchQuery)}>
                <Plus size={14} /> Add new tag: <strong>{searchQuery.trim()}</strong>
              </div>
            )}
            {filteredSuggestions.map(tag => {
              const isPartial = currentPartialTags.some(t => t.toLowerCase() === tag.name.toLowerCase());
              return (
                <TagPill
                  key={tag.name}
                  tag={isPartial ? `${tag.name} (apply to all)` : tag.name}
                  onClick={() => handleAddTag(tag.name)}
                  className="suggestion"
                />
              );
            })}
            {!searchQuery && filteredSuggestions.length === 0 && allTags.length > 0 && (
              <span className="no-tags-found">All library tags are already selected</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
