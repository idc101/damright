import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderSyncModal } from '../components/FolderSyncModal';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('FolderSyncModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders FolderSyncModal with sources and handles tab switching', async () => {
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_all_sources') {
        return [
          { id: '1', path: '/Users/user/Pictures/Library', name: 'Library', sync_mode: 'push' },
          { id: '2', path: '/Users/user/Pictures/Inbox', name: 'Inbox', sync_mode: 'pull' },
        ];
      }
      if (cmd === 'get_sync_config') {
        return {
          server_sync: { endpoint: 'http://localhost:8010', enabled: true, debounce_minutes: 30 },
          local: { web_port: 8010 },
        };
      }
      return null;
    });

    render(<FolderSyncModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Manage Library Folders & Home Server Sync/i)).toBeInTheDocument();
      expect(screen.getByText('Library')).toBeInTheDocument();
      expect(screen.getByText('Inbox')).toBeInTheDocument();
    });

    // Switch to Server Settings tab
    const serverTab = screen.getByRole('button', { name: /Home Server Sync Settings/i });
    fireEvent.click(serverTab);

    expect(screen.getByDisplayValue('http://localhost:8010')).toBeInTheDocument();
  });

  it('handles sync mode toggles for folders', async () => {
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_all_sources') {
        return [
          { id: '1', path: '/Users/user/Pictures/Library', name: 'Library', sync_mode: 'push' },
        ];
      }
      if (cmd === 'get_sync_config') {
        return { server_sync: { endpoint: 'http://localhost:8010', enabled: false, debounce_minutes: 30 }, local: { web_port: 8010 } };
      }
      if (cmd === 'update_source_sync_settings') return null;
      return null;
    });

    render(<FolderSyncModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Library')).toBeInTheDocument();
    });

    const pullBtn = screen.getByRole('button', { name: /Pull \(Inbox\)/i });
    fireEvent.click(pullBtn);

    expect(invoke).toHaveBeenCalledWith('update_source_sync_settings', {
      id: '1',
      syncMode: 'pull',
      serverPath: 'Library',
      archivePrefix: null,
      ratingEnabled: true,
    });
  });

  it('handles rating eligibility toggles for folders', async () => {
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_all_sources') {
        return [
          { id: '1', path: '/Users/user/Pictures/Library', name: 'Library', sync_mode: 'push', rating_enabled: true },
        ];
      }
      if (cmd === 'get_sync_config') {
        return { server_sync: { endpoint: 'http://localhost:8010', enabled: false, debounce_minutes: 30 }, local: { web_port: 8010 } };
      }
      if (cmd === 'update_source_sync_settings') return null;
      return null;
    });

    render(<FolderSyncModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Library')).toBeInTheDocument();
    });

    const excludeBtn = screen.getByRole('button', { name: /Excluded/i });
    fireEvent.click(excludeBtn);

    expect(invoke).toHaveBeenCalledWith('update_source_sync_settings', {
      id: '1',
      syncMode: 'push',
      serverPath: 'Library',
      archivePrefix: null,
      ratingEnabled: false,
    });
  });
});
