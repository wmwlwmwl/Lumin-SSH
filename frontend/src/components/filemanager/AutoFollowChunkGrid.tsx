import { useEffect, useRef } from 'react';
import Tiptop from '../Tiptop.tsx';
import { type TransferChunk } from '../../utils/fileWorkbench.ts';
import { getChunkColor } from './uploadQueueMeta.tsx';

interface AutoFollowChunkGridProps {
  chunks: TransferChunk[];
  titleBuilder: (chunk: TransferChunk) => string;
}

export default function AutoFollowChunkGrid({ chunks, titleBuilder }: AutoFollowChunkGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoFollowRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldAutoFollowRef.current) {
      return undefined;
    }
    const rafId = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [chunks]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoFollowRef.current = distanceToBottom <= 12;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="grid grid-cols-[repeat(auto-fill,minmax(8px,1fr))] gap-[3px] max-h-[88px] overflow-y-auto"
    >
      {chunks.map((chunk) => (
        <Tiptop key={chunk.index} text={titleBuilder(chunk)} style={{ display: 'block' }}>
          <div
            className="h-2 min-w-2 rounded-full"
            style={{
              background: getChunkColor(chunk.status),
              opacity: chunk.status === 'queued' ? 0.42 : 1,
              boxShadow: chunk.status === 'uploading' || chunk.status === 'retrying' ? `0 0 8px ${getChunkColor(chunk.status)}` : 'none',
              transition: 'background 120ms ease, opacity 120ms ease, box-shadow 120ms ease',
            }}
          />
        </Tiptop>
      ))}
    </div>
  );
}
