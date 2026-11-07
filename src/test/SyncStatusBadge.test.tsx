import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('SyncStatusBadge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders SyncStatusBadge when sync is disabled', async () => {
    (invoke as any).mockResolvedValueOnce({
      stage: 'Idle',
      enabled: false,
      debounce_minutes: 30,
    });

    render(<SyncStatusBadge />);

    await waitFor(() => {
      expect(screen.getByText(/Sync Off/i)).toBeInTheDocument();
    });
  });

  it('renders SyncStatusBadge when synced', async () => {
    (invoke as any).mockResolvedValueOnce({
      stage: 'Idle',
      enabled: true,
      debounce_minutes: 30,
    });

    render(<SyncStatusBadge />);

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });
  });

  it('renders Sync Now button on main UI when sync is enabled and triggers sync on click', async () => {
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_sync_status') return { stage: 'Idle', enabled: true, debounce_minutes: 30 };
      if (cmd === 'trigger_sync_now') return 5;
      return null;
    });

    render(<SyncStatusBadge />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sync Now/i })).toBeInTheDocument();
    });

    const syncNowButton = screen.getByRole('button', { name: /Sync Now/i });
    fireEvent.click(syncNowButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('trigger_sync_now');
    });
  });
});
