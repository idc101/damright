import { Image, Folder, Search } from 'lucide-react';
import './BottomNavBar.css';

interface BottomNavBarProps {
  activeTab: 'library' | 'albums' | 'search';
  onTabChange: (tab: 'library' | 'albums' | 'search') => void;
}

export function BottomNavBar({ activeTab, onTabChange }: BottomNavBarProps) {
  return (
    <nav className="bottom-nav">
      <button 
        className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
        onClick={() => onTabChange('library')}
      >
        <Image size={24} />
        <span>Library</span>
      </button>
      <button 
        className={`nav-item ${activeTab === 'albums' ? 'active' : ''}`}
        onClick={() => onTabChange('albums')}
      >
        <Folder size={24} />
        <span>Albums</span>
      </button>
      <button 
        className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
        onClick={() => onTabChange('search')}
      >
        <Search size={24} />
        <span>Search</span>
      </button>
    </nav>
  );
}
