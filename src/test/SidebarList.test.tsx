import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SidebarList } from "../components/SidebarList";
import { Users } from "lucide-react";

const mockPeople = [
  { name: "Alice", count: 5 },
  { name: "Bob", count: 3 }
];

test("renders sidebar list with counts", () => {
  render(
    <SidebarList 
      items={mockPeople} 
      selectedItem={null} 
      onSelectItem={() => {}} 
      icon={Users}
      allLabel="All People"
      emptyMessage="No people found."
    />
  );
  
  expect(screen.getByText("All People")).toBeInTheDocument();
  expect(screen.getByText("Alice")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
});

test("highlights selected item", () => {
  render(
    <SidebarList 
      items={mockPeople} 
      selectedItem="Alice" 
      onSelectItem={() => {}} 
      icon={Users}
      allLabel="All People"
      emptyMessage="No people found."
    />
  );
  
  const aliceElement = screen.getByText("Alice").closest(".tag-item");
  expect(aliceElement).toHaveClass("selected");
});

test("calls onSelectItem when clicked", () => {
  const onSelectItem = vi.fn();
  render(
    <SidebarList 
      items={mockPeople} 
      selectedItem={null} 
      onSelectItem={onSelectItem} 
      icon={Users}
      allLabel="All People"
      emptyMessage="No people found."
    />
  );
  
  fireEvent.click(screen.getByText("Alice"));
  expect(onSelectItem).toHaveBeenCalledWith("Alice");
  
  fireEvent.click(screen.getByText("All People"));
  expect(onSelectItem).toHaveBeenCalledWith(null);
});
