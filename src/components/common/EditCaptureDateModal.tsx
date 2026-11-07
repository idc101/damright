import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import { Photo } from '../../types';
import { Check } from 'lucide-react';
import { useApi } from '../../services/ApiProvider';
import './EditCaptureDateModal.css';

interface EditCaptureDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPhotos: Photo[];
  onUpdate: (updates: { id: string; captureTime: string }[]) => void;
}

type TabMode = 'exact' | 'fuzzy' | 'shift';

export const EditCaptureDateModal: React.FC<EditCaptureDateModalProps> = ({ 
  isOpen, 
  onClose, 
  selectedPhotos,
  onUpdate 
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('exact');
  const [exactDate, setExactDate] = useState('');
  
  // Fuzzy State
  const [fuzzyYear, setFuzzyYear] = useState('');
  const [fuzzySeason, setFuzzySeason] = useState('summer');
  const [fuzzyTime, setFuzzyTime] = useState('afternoon');

  // Shift State
  const [referencePhotoId, setReferencePhotoId] = useState<string>(selectedPhotos[0]?.id || '');
  const [refNewDate, setRefNewDate] = useState('');

  const api = useApi();

  useEffect(() => {
    if (isOpen && selectedPhotos.length > 0) {
      setReferencePhotoId(selectedPhotos[0].id);
      
      // Default exact date to first photo's date
      if (selectedPhotos[0].capture_time) {
        setExactDate(formatToInput(selectedPhotos[0].capture_time));
        setRefNewDate(formatToInput(selectedPhotos[0].capture_time));
      } else {
        const now = new Date();
        setExactDate(now.toISOString().slice(0, 16));
        setRefNewDate(now.toISOString().slice(0, 16));
      }

      // Try to extract year from folder name
      const firstPath = selectedPhotos[0].path;
      const parts = firstPath.split(/[/\\]/);
      const folderName = parts[parts.length - 2] || '';
      const yearMatch = folderName.match(/^(\d{4})/);
      if (yearMatch) {
        setFuzzyYear(yearMatch[1]);
      }
    }
  }, [isOpen, selectedPhotos]);

  const previewUpdates = useMemo(() => {
    if (activeTab === 'exact') {
      const dateStr = formatFromInput(exactDate);
      return selectedPhotos.map(p => ({
        id: p.id,
        name: p.path.split(/[/\\]/).pop() || '',
        oldDate: p.capture_time || 'Unknown',
        newDate: dateStr,
        thumb: p.thumb_path
      }));
    } else if (activeTab === 'fuzzy') {
      const year = parseInt(fuzzyYear) || new Date().getFullYear();
      let month = 6; // Summer (July)
      let day = 15;
      
      if (fuzzySeason === 'spring') month = 3; // April
      else if (fuzzySeason === 'autumn') month = 9; // Oct
      else if (fuzzySeason === 'winter') {
          month = 0; // Jan
          day = 15;
      }

      let hour = 14; // Afternoon
      if (fuzzyTime === 'morning') hour = 9;
      else if (fuzzyTime === 'evening') hour = 19;

      const date = new Date(year, month, day, hour, 0, 0);
      const dateStr = formatDate(date);

      return selectedPhotos.map(p => ({
        id: p.id,
        name: p.path.split(/[/\\]/).pop() || '',
        oldDate: p.capture_time || 'Unknown',
        newDate: dateStr,
        thumb: p.thumb_path
      }));
    } else if (activeTab === 'shift') {
      const refPhoto = selectedPhotos.find(p => p.id === referencePhotoId);
      if (!refPhoto || !refPhoto.capture_time) return [];

      const oldRefDate = parseDate(refPhoto.capture_time);
      const newRefDate = new Date(refNewDate);
      const delta = newRefDate.getTime() - oldRefDate.getTime();

      return selectedPhotos.map(p => {
        const oldDate = p.capture_time ? parseDate(p.capture_time) : oldRefDate;
        const newDate = new Date(oldDate.getTime() + delta);
        return {
          id: p.id,
          name: p.path.split(/[/\\]/).pop() || '',
          oldDate: p.capture_time || 'Unknown',
          newDate: formatDate(newDate),
          thumb: p.thumb_path
        };
      });
    }
    return [];
  }, [activeTab, exactDate, fuzzyYear, fuzzySeason, fuzzyTime, referencePhotoId, refNewDate, selectedPhotos]);

  const handleApply = () => {
    const updates = previewUpdates.map(p => ({ id: p.id, captureTime: p.newDate }));
    onUpdate(updates);
    onClose();
  };

  return (
    <Modal
      title="Edit Capture Date"
      isOpen={isOpen}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleApply}>Apply to {selectedPhotos.length} Photos</button>
        </>
      }
    >
      <div className="edit-date-modal">
        <div className="date-modal-tabs">
          <button 
            className={`date-modal-tab ${activeTab === 'exact' ? 'active' : ''}`}
            onClick={() => setActiveTab('exact')}
          >
            Exact Date
          </button>
          <button 
            className={`date-modal-tab ${activeTab === 'fuzzy' ? 'active' : ''}`}
            onClick={() => setActiveTab('fuzzy')}
          >
            Fuzzy Date
          </button>
          <button 
            className={`date-modal-tab ${activeTab === 'shift' ? 'active' : ''}`}
            onClick={() => setActiveTab('shift')}
          >
            Shift Dates
          </button>
        </div>

        <div className="date-modal-content">
          {activeTab === 'exact' && (
            <div className="input-group">
              <label>Assign Exact Date/Time</label>
              <input 
                type="datetime-local" 
                value={exactDate} 
                onChange={(e) => setExactDate(e.target.value)} 
              />
            </div>
          )}

          {activeTab === 'fuzzy' && (
            <div className="input-row">
              <div className="input-group">
                <label>Year</label>
                <input 
                  type="number" 
                  value={fuzzyYear} 
                  onChange={(e) => setFuzzyYear(e.target.value)} 
                  placeholder="e.g. 1980"
                />
              </div>
              <div className="input-group">
                <label>Season</label>
                <select value={fuzzySeason} onChange={(e) => setFuzzySeason(e.target.value)}>
                  <option value="spring">Spring</option>
                  <option value="summer">Summer</option>
                  <option value="autumn">Autumn</option>
                  <option value="winter">Winter</option>
                </select>
              </div>
              <div className="input-group">
                <label>Time of Day</label>
                <select value={fuzzyTime} onChange={(e) => setFuzzyTime(e.target.value)}>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'shift' && (
            <>
              <div className="reference-selection">
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>1. Select Reference Photo</label>
                <div className="reference-selector">
                  {selectedPhotos.map(p => (
                    <div 
                      key={p.id} 
                      className={`ref-item ${referencePhotoId === p.id ? 'selected' : ''}`}
                      onClick={() => {
                        setReferencePhotoId(p.id);
                        if (p.capture_time) setRefNewDate(formatToInput(p.capture_time));
                      }}
                    >
                      <img src={api.getAssetUrl(p.thumb_path)} alt={p.id} />
                      {referencePhotoId === p.id && <div className="ref-check"><Check size={12} /></div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="input-group">
                <label>2. Set New Date for Reference Photo</label>
                <input 
                  type="datetime-local" 
                  value={refNewDate} 
                  onChange={(e) => setRefNewDate(e.target.value)} 
                />
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '5px' }}>
                  All other photos will be shifted by the same relative amount.
                </p>
              </div>
            </>
          )}

          <div className="preview-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Original Date</th>
                  <th>New Date</th>
                </tr>
              </thead>
              <tbody>
                {previewUpdates.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img src={api.getAssetUrl(p.thumb)} className="preview-thumb" alt="" />
                        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </span>
                      </div>
                    </td>
                    <td>{p.oldDate}</td>
                    <td style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{p.newDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// Helper to convert DB date "YYYY-MM-DD HH:MM:SS" to input "YYYY-MM-DDTHH:MM"
function formatToInput(dbDate: string): string {
  return dbDate.replace(' ', 'T').slice(0, 16);
}

// Helper to convert input "YYYY-MM-DDTHH:MM" to DB "YYYY-MM-DD HH:MM:SS"
function formatFromInput(inputDate: string): string {
  return inputDate.replace('T', ' ') + ':00';
}

// Helper to format Date object to DB string
function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Helper to parse DB date string to Date object
function parseDate(dbDate: string): Date {
  // DB Format: "YYYY-MM-DD HH:MM:SS"
  // Some browsers might not like this directly, so convert to ISO
  return new Date(dbDate.replace(' ', 'T'));
}
