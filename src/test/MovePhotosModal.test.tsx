import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MovePhotosModal, getSuggestedFolderName } from '../components/common/MovePhotosModal';
import { DirEntry, Photo } from '../types';

describe('MovePhotosModal', () => {
  const mockTrees: DirEntry[] = [
    {
      name: '2026',
      path: '/Pictures/2026',
      photo_count: 1,
      children: [
        {
          name: '08-16',
          path: '/Pictures/2026/08-16',
          photo_count: 1,
          children: [],
        },
      ],
    },
    {
      name: 'Archive',
      path: '/Pictures/Archive',
      photo_count: 0,
      children: [],
    },
  ];

  const mockPhoto: Photo = {
    id: 'photo-1',
    path: '/Pictures/2026/08-16/IMG_0001.jpg',
    thumb_path: '/thumb/IMG_0001.jpg',
    exposure: 0,
    rating: 5,
    rejected: false,
    tags: 'family',
    orientation: 1,
    mime_type: 'image/jpeg',
    capture_time: '2026-08-16 14:30:00',
    event: 'Summer Holiday',
  };

  describe('getSuggestedFolderName', () => {
    it('suggests MM-DD Event inside a year folder', () => {
      expect(getSuggestedFolderName('/Pictures/2026', mockPhoto)).toBe('08-16 Summer Holiday');
    });

    it('suggests MM-DD inside a year folder when photo has no event', () => {
      const photoNoEvent = { ...mockPhoto, event: undefined };
      expect(getSuggestedFolderName('/Pictures/2026', photoNoEvent)).toBe('08-16');
    });

    it('suggests YYYY-MM-DD Event inside a non-year folder', () => {
      expect(getSuggestedFolderName('/Pictures/Archive', mockPhoto)).toBe('2026-08-16 Summer Holiday');
    });

    it('suggests YYYY-MM-DD inside a non-year folder when photo has no event', () => {
      const photoNoEvent = { ...mockPhoto, event: undefined };
      expect(getSuggestedFolderName('/Pictures/Archive', photoNoEvent)).toBe('2026-08-16');
    });

    it('suggests Event when parent is already a date folder and event exists', () => {
      expect(getSuggestedFolderName('/Pictures/2026/08-16', mockPhoto)).toBe('Summer Holiday');
    });

    it('handles photo with only event and no capture time', () => {
      const photoEventOnly = { ...mockPhoto, capture_time: null, event: 'Birthday Party' };
      expect(getSuggestedFolderName('/Pictures/2026', photoEventOnly)).toBe('Birthday Party');
    });

    it('falls back to New Folder when no metadata is available', () => {
      const blankPhoto = { ...mockPhoto, capture_time: null, event: null };
      expect(getSuggestedFolderName('/Pictures/2026', blankPhoto)).toBe('New Folder');
      expect(getSuggestedFolderName(null, null)).toBe('New Folder');
    });
  });

  it('renders move modal with auto-rename option checked by default', () => {
    const handleMove = vi.fn();
    const handleClose = vi.fn();

    render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
      />
    );

    expect(screen.getByText(/Move 1 Photo/i)).toBeInTheDocument();
    
    // Auto-rename checkbox should be checked by default
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('triggers onMove with autoRename flag when folder selected and Move clicked', () => {
    const handleMove = vi.fn();
    const handleClose = vi.fn();

    render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={2}
      />
    );

    // Select a folder in tree
    const folderLabel = screen.getByText('2026');
    fireEvent.click(folderLabel);

    // Shows target preview
    expect(screen.getByTestId('destination-preview')).toHaveTextContent('/Pictures/2026');

    // Click Move button
    const moveButton = screen.getByRole('button', { name: /^Move$/i });
    expect(moveButton).not.toBeDisabled();
    fireEvent.click(moveButton);

    expect(handleMove).toHaveBeenCalledWith('/Pictures/2026', true);
  });

  it('resets state when reopened so previous folder and input are not remembered', () => {
    const handleMove = vi.fn();
    const handleClose = vi.fn();

    const { rerender } = render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
        initialPhoto={mockPhoto}
      />
    );

    // Select folder and open new folder input
    fireEvent.click(screen.getByText('2026'));
    fireEvent.click(screen.getByText(/Create New Folder in Selected/i));

    const input = screen.getByPlaceholderText('Folder name...');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Custom Trip' } });

    // Close modal
    rerender(
      <MovePhotosModal
        isOpen={false}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
        initialPhoto={mockPhoto}
      />
    );

    // Reopen modal
    rerender(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
        initialPhoto={mockPhoto}
      />
    );

    // New folder input should be closed and Move button should be disabled (no folder selected)
    expect(screen.queryByPlaceholderText('Folder name...')).not.toBeInTheDocument();
    const moveButton = screen.getByRole('button', { name: /^Move$/i });
    expect(moveButton).toBeDisabled();
    expect(screen.queryByTestId('destination-preview')).not.toBeInTheDocument();
  });

  it('creates new folder using OK button and updates target destination', () => {
    const handleMove = vi.fn();
    const handleClose = vi.fn();

    render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
        initialPhoto={mockPhoto}
      />
    );

    // Select year folder
    fireEvent.click(screen.getByText('2026'));

    // Click Create New Folder
    fireEvent.click(screen.getByText(/Create New Folder in Selected/i));

    // Input should be pre-filled with suggested name "08-16 Summer Holiday"
    const input = screen.getByPlaceholderText('Folder name...') as HTMLInputElement;
    expect(input.value).toBe('08-16 Summer Holiday');

    // Click OK button
    const okBtn = screen.getByRole('button', { name: 'OK' });
    fireEvent.click(okBtn);

    // Input is closed, target is updated to new path
    expect(screen.queryByPlaceholderText('Folder name...')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination-preview')).toHaveTextContent('/Pictures/2026/08-16 Summer Holiday');

    // Click Move button
    const moveButton = screen.getByRole('button', { name: /^Move$/i });
    fireEvent.click(moveButton);

    expect(handleMove).toHaveBeenCalledWith('/Pictures/2026/08-16 Summer Holiday', true);
  });

  it('creates new folder using Enter key in input', () => {
    const handleMove = vi.fn();
    const handleClose = vi.fn();

    render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={1}
        initialPhoto={mockPhoto}
      />
    );

    fireEvent.click(screen.getByText('Archive'));
    fireEvent.click(screen.getByText(/Create New Folder in Selected/i));

    const input = screen.getByPlaceholderText('Folder name...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-Holiday' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.queryByPlaceholderText('Folder name...')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination-preview')).toHaveTextContent('/Pictures/Archive/2026-Holiday');

    fireEvent.click(screen.getByRole('button', { name: /^Move$/i }));
    expect(handleMove).toHaveBeenCalledWith('/Pictures/Archive/2026-Holiday', true);
  });

  it('shows progress spinner and disables buttons while moving files', async () => {
    let resolveMove: () => void = () => {};
    const handleMove = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveMove = resolve;
      });
    });
    const handleClose = vi.fn();

    render(
      <MovePhotosModal
        isOpen={true}
        onClose={handleClose}
        onMove={handleMove}
        trees={mockTrees}
        selectedCount={3}
      />
    );

    fireEvent.click(screen.getByText('2026'));

    const moveButton = screen.getByRole('button', { name: /^Move$/i });
    fireEvent.click(moveButton);

    // Spinner and moving state active
    expect(screen.getByText(/Moving\.\.\./i)).toBeInTheDocument();
    expect(screen.getByTestId('move-progress-banner')).toHaveTextContent(/Moving 3 photos\.\.\./i);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toBeDisabled();
    expect(screen.getByRole('button', { name: /Moving\.\.\./i })).toBeDisabled();

    // Resolve move operation
    resolveMove();

    await waitFor(() => {
      expect(screen.queryByTestId('move-progress-banner')).not.toBeInTheDocument();
    });
  });
});

