import { LucideIcon } from "lucide-react";

export interface SidebarListItem {
  name: string;
  count: number;
}

interface SidebarListProps<T extends SidebarListItem> {
  items: T[];
  selectedItem: string | null;
  onSelectItem: (name: string | null) => void;
  icon: LucideIcon;
  allLabel: string;
  emptyMessage: string;
}

export function SidebarList<T extends SidebarListItem>({
  items,
  selectedItem,
  onSelectItem,
  icon: Icon,
  allLabel,
  emptyMessage,
}: SidebarListProps<T>) {
  return (
    <div className="tag-list">
      <div 
        className={`tag-item ${selectedItem === null ? "selected" : ""}`}
        onClick={() => onSelectItem(null)}
      >
        <Icon size={16} />
        <span>{allLabel}</span>
      </div>
      {items.map((item) => (
        <div 
          key={item.name} 
          className={`tag-item ${selectedItem === item.name ? "selected" : ""}`}
          onClick={() => onSelectItem(item.name)}
        >
          <Icon size={16} />
          <span className="tag-name">{item.name}</span>
          <span className="tag-count">{item.count}</span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="empty-tags">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
