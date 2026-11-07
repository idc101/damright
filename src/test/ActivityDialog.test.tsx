import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityBadge } from '../components/ActivityBadge';
import { ActivityDialog } from '../components/ActivityDialog';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('ActivityBadge & ActivityDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders ActivityBadge in idle state when no tasks are running', async () => {
    (invoke as any).mockResolvedValueOnce({
      stage: 'Idle',
      enabled: true,
      debounce_minutes: 30,
    });

    render(<ActivityBadge />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-badge-button')).toBeInTheDocument();
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });
  });

  it('opens ActivityDialog when ActivityBadge icon is clicked', async () => {
    (invoke as any).mockResolvedValue({
      stage: 'Idle',
      enabled: true,
      debounce_minutes: 30,
    });

    render(<ActivityBadge />);

    const badgeButton = await screen.findByTestId('activity-badge-button');
    fireEvent.click(badgeButton);

    await waitFor(() => {
      expect(screen.getByTestId('activity-dialog-overlay')).toBeInTheDocument();
      expect(screen.getByText(/Activity Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Server Sync/i)).toBeInTheDocument();
      expect(screen.getByText(/Folder Import & Refresh/i)).toBeInTheDocument();
      expect(screen.getByText(/Photo Export/i)).toBeInTheDocument();
    });
  });

  it('shows combined percentage when background tasks are active', async () => {
    (invoke as any).mockResolvedValue({
      stage: {
        Syncing: {
          files_done: 5,
          total_files: 10,
          bytes_done: 500,
          total_bytes: 1000,
          current_file: 'photo1.jpg',
        },
      },
      enabled: true,
      debounce_minutes: 30,
    });

    render(
      <ActivityBadge
        exporting={true}
        exportProgress={{ message: 'Exporting...', current: 5, total: 10 }}
      />
    );

    await waitFor(() => {
      // 5/10 sync + 5/10 export = 10/20 = 50%
      expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    });
  });

  it('renders active progress and task cards in ActivityDialog', () => {
    const handleClose = vi.fn();
    const handleSyncNow = vi.fn().mockResolvedValue(undefined);
    const handleOpenSyncConfig = vi.fn();

    render(
      <ActivityDialog
        isOpen={true}
        onClose={handleClose}
        syncStatus={{
          stage: {
            Syncing: {
              files_done: 3,
              total_files: 10,
              bytes_done: 300,
              total_bytes: 1000,
              current_file: 'test_sync.jpg',
            },
          },
          enabled: true,
          debounce_minutes: 30,
        }}
        onSyncNow={handleSyncNow}
        onOpenSyncConfig={handleOpenSyncConfig}
        importing={true}
        importProgress={{ message: 'Importing 2/5 photos...', current: 2, total: 5 }}
        exporting={false}
        exportProgress={null}
      />
    );

    expect(screen.getByText(/Activity Center/i)).toBeInTheDocument();
    expect(screen.getByText(/test_sync.jpg/i)).toBeInTheDocument();
    expect(screen.getByText(/Importing 2\/5 photos.../i)).toBeInTheDocument();

    const configureBtn = screen.getByRole('button', { name: /Configure Sync/i });
    fireEvent.click(configureBtn);
    expect(handleOpenSyncConfig).toHaveBeenCalled();
  });

  it('calculates sync progress percentage accurately using bytes_done and total_bytes when files_done is 0', async () => {
    (invoke as any).mockResolvedValue({
      stage: {
        Syncing: {
          files_done: 0,
          total_files: 1,
          bytes_done: 250,
          total_bytes: 1000,
          current_file: 'large_photo.jpg',
        },
      },
      enabled: true,
      debounce_minutes: 30,
    });

    render(<ActivityBadge />);

    await waitFor(() => {
      // 250 / 1000 = 25% (even though files_done is 0/1)
      expect(screen.getByText('25%')).toBeInTheDocument();
    });
  });

  it('renders detailed scanning diagnostics when Scanning stage has step and files_scanned', () => {
    render(
      <ActivityDialog
        isOpen={true}
        onClose={vi.fn()}
        syncStatus={{
          stage: {
            Scanning: {
              current_step: 'Scanning local folder \'Library\'',
              files_scanned: 1420,
              current_folder: 'Library',
            },
          },
          enabled: true,
          debounce_minutes: 30,
        }}
        onSyncNow={vi.fn()}
        onOpenSyncConfig={vi.fn()}
        importing={false}
        importProgress={null}
        exporting={false}
        exportProgress={null}
      />
    );

    expect(screen.getAllByText(/Scanning local folder 'Library'/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,420 checked/i).length).toBeGreaterThan(0);
  });
});
