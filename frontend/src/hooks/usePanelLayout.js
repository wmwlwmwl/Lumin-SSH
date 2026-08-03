import { useCallback, useEffect, useRef, useState } from 'react';
import { clampPanelWidth } from '../components/probeFormatting.js';

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;
const PROBE_PANEL_MIN = 280;
const AI_PANEL_MIN = 450;

export default function usePanelLayout() {
  const [leftSplitWidth, setLeftSplitWidth] = useState(() => Number.parseInt(localStorage.getItem('leftSplitWidth') || '320', 10));
  const [bottomSplitHeight, setBottomSplitHeight] = useState(() => Number.parseInt(localStorage.getItem('bottomSplitHeight') || '250', 10));
  const [probePanelWidth, setProbePanelWidth] = useState(() => clampPanelWidth(localStorage.getItem('probePanelWidth') || '320', PROBE_PANEL_MIN));
  const [probePanelPosition, setProbePanelPositionState] = useState(() => localStorage.getItem('probePanelPosition') || 'left');
  const [probePanelCollapsed, setProbePanelCollapsedState] = useState(() => localStorage.getItem('probePanelCollapsed') === 'true');
  const [aiPanelWidth, setAiPanelWidth] = useState(() => clampPanelWidth(localStorage.getItem('aiPanelWidth') || '450', AI_PANEL_MIN));
  const [showAIPanel, setShowAIPanel] = useState(() => localStorage.getItem('showAIPanel') !== 'false');
  const leftSplitWidthRef = useRef(leftSplitWidth);
  const bottomSplitHeightRef = useRef(bottomSplitHeight);
  const probePanelWidthRef = useRef(probePanelWidth);
  const aiPanelWidthRef = useRef(aiPanelWidth);

  const updateLeftSplitWidth = useCallback((value) => {
    const next = Math.max(FILE_MANAGER_LEFT_MIN, Math.min(800, Number(value) || FILE_MANAGER_LEFT_MIN));
    leftSplitWidthRef.current = next;
    setLeftSplitWidth(next);
  }, []);

  const updateBottomSplitHeight = useCallback((value) => {
    const next = Math.max(FILE_MANAGER_BOTTOM_MIN, Math.min(600, Number(value) || FILE_MANAGER_BOTTOM_MIN));
    bottomSplitHeightRef.current = next;
    setBottomSplitHeight(next);
  }, []);

  const updateProbePanelWidth = useCallback((value) => {
    const next = clampPanelWidth(value, PROBE_PANEL_MIN);
    probePanelWidthRef.current = next;
    setProbePanelWidth(next);
  }, []);

  const updateAiPanelWidth = useCallback((value) => {
    const next = clampPanelWidth(value, AI_PANEL_MIN);
    aiPanelWidthRef.current = next;
    setAiPanelWidth(next);
  }, []);

  const setProbePanelCollapsedPersistent = useCallback((value) => {
    const next = !!value;
    setProbePanelCollapsedState(next);
    localStorage.setItem('probePanelCollapsed', String(next));
  }, []);

  const setProbePanelPosition = useCallback((value) => {
    const next = value === 'right' ? 'right' : 'left';
    setProbePanelPositionState(next);
    localStorage.setItem('probePanelPosition', next);
  }, []);

  const setAIPanelVisibility = useCallback((value) => {
    const next = !!value;
    setShowAIPanel(next);
    localStorage.setItem('showAIPanel', String(next));
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const next = typeof event.detail === 'boolean'
        ? event.detail : localStorage.getItem('showAIPanel') !== 'false';
      setShowAIPanel(next);
      localStorage.setItem('showAIPanel', String(next));
    };
    window.addEventListener('ai-panel-visibility-changed', handler);
    return () => window.removeEventListener('ai-panel-visibility-changed', handler);
  }, []);

  return {
    leftSplitWidth,
    bottomSplitHeight,
    probePanelWidth,
    probePanelPosition,
    probePanelCollapsed,
    aiPanelWidth,
    showAIPanel,
    leftSplitWidthRef,
    bottomSplitHeightRef,
    probePanelWidthRef,
    aiPanelWidthRef,
    updateLeftSplitWidth,
    updateBottomSplitHeight,
    updateProbePanelWidth,
    updateAiPanelWidth,
    setProbePanelCollapsedPersistent,
    setProbePanelPosition,
    setAIPanelVisibility,
  };
}
