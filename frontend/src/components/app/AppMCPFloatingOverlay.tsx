import type React from 'react';
import MCPActivityPanel, { MCPActivityFloatingToggle } from '../MCPActivityPanel.tsx';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';

export interface AppMCPFloatingOverlayProps {
  mcpActivityEnabled: boolean;
  sessions: SessionLike[];
  showMCPActivity: boolean;
  mcpToggleOffset: { x: number; y: number };
  mcpActivityOffset: { x: number; y: number };
  handleMCPToggleClick: () => void;
  handleMCPToggleDragStart: (e: { button?: number; clientX: number; clientY: number }) => void;
  setMcpToggleOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setShowMCPActivity: React.Dispatch<React.SetStateAction<boolean>>;
  openMCPActivity: () => void;
  handleMCPActivityDragStart: (e: { button?: number; clientX: number; clientY: number }) => void;
  setMcpActivityOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
}

export default function AppMCPFloatingOverlay({
  mcpActivityEnabled,
  sessions,
  showMCPActivity,
  mcpToggleOffset,
  mcpActivityOffset,
  handleMCPToggleClick,
  handleMCPToggleDragStart,
  setMcpToggleOffset,
  setShowMCPActivity,
  openMCPActivity,
  handleMCPActivityDragStart,
  setMcpActivityOffset,
}: AppMCPFloatingOverlayProps) {
  if (!mcpActivityEnabled || !sessions.some((s) => s.status === 'connected')) {
    return null;
  }

  return (
    <>
      <MCPActivityFloatingToggle
        visible={!showMCPActivity}
        offset={mcpToggleOffset}
        onClick={handleMCPToggleClick}
        onPointerDown={handleMCPToggleDragStart}
        onDoubleClick={() => setMcpToggleOffset({ x: 0, y: 0 })}
      />
      <div style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        width: '380px',
        maxWidth: 'calc(100vw - 32px)',
        height: '60vh',
        maxHeight: '600px',
        zIndex: 9999,
        display: showMCPActivity ? 'block' : 'none',
        transform: `translate(${mcpActivityOffset.x}px, ${mcpActivityOffset.y}px)`,
      }}>
        <MCPActivityPanel
          onClose={() => setShowMCPActivity(false)}
          onApprovalRequired={openMCPActivity}
          onHeaderPointerDown={handleMCPActivityDragStart}
          onHeaderDoubleClick={() => setMcpActivityOffset({ x: 0, y: 0 })}
        />
      </div>
    </>
  );
}
