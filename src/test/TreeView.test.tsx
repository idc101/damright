import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import TreeView from "../components/TreeView";
import { DirEntry } from "../types";

const mockNode: DirEntry = {
  name: "Photos",
  path: "/path/to/photos",
  photo_count: 42,
  children: [
    {
      name: "Vacation",
      path: "/path/to/photos/vacation",
      photo_count: 10,
      children: [],
    },
  ],
};

test("renders node name and photo count", () => {
  render(
    <TreeView 
      node={mockNode} 
      onSelect={() => {}} 
      selectedPath={null} 
      onRefresh={() => {}} 
      onPhotosDeleted={() => {}} 
      onAutoRename={async () => 0}
    />
  );
  
  expect(screen.getByText("Photos")).toBeInTheDocument();
  expect(screen.getByText("(42)")).toBeInTheDocument();
  
  // Vacation is a child, and should be rendered by default now
  expect(screen.getByText("Vacation")).toBeInTheDocument();
  expect(screen.getByText("(10)")).toBeInTheDocument();
});

test("automatically expands parent when child is selected", () => {
  // Set the folder expansion state to false (collapsed) in localStorage
  localStorage.setItem("expanded_node:/path/to/photos", "false");

  const { rerender } = render(
    <TreeView 
      node={mockNode} 
      onSelect={() => {}} 
      selectedPath={null} 
      onRefresh={() => {}} 
      onPhotosDeleted={() => {}} 
      onAutoRename={async () => 0}
    />
  );

  // Since it is collapsed, "Vacation" should not be rendered
  expect(screen.queryByText("Vacation")).not.toBeInTheDocument();

  // Rerender with selectedPath pointing to the child node
  rerender(
    <TreeView 
      node={mockNode} 
      onSelect={() => {}} 
      selectedPath="/path/to/photos/vacation" 
      onRefresh={() => {}} 
      onPhotosDeleted={() => {}} 
      onAutoRename={async () => 0}
    />
  );

  // It should now be expanded and "Vacation" should be visible
  expect(screen.getByText("Vacation")).toBeInTheDocument();
  expect(localStorage.getItem("expanded_node:/path/to/photos")).toBe("true");
});

test("shows move / rename option in context menu for non-root folders and triggers callback", () => {
  const onMoveFolder = vi.fn();
  render(
    <TreeView 
      node={mockNode} 
      onSelect={() => {}} 
      selectedPath={null} 
      onRefresh={() => {}} 
      onPhotosDeleted={() => {}} 
      onAutoRename={async () => 0}
      onMoveFolder={onMoveFolder}
      isSourceRoot={true}
    />
  );

  // Right-click on child node "Vacation"
  const vacationNode = screen.getByText("Vacation");
  fireEvent.contextMenu(vacationNode);

  const moveBtn = screen.getByTestId("move-folder-menu-btn");
  expect(moveBtn).toBeInTheDocument();
  expect(moveBtn).toHaveTextContent("Move / Rename Folder...");

  fireEvent.click(moveBtn);
  expect(onMoveFolder).toHaveBeenCalledWith(mockNode.children[0]);
});

