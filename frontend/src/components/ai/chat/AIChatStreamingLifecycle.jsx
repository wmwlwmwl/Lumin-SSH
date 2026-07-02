import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n.js';
import AIChatApprovalCard from './AIChatApprovalCard.jsx';
import AIChatAssistantMessage from './AIChatAssistantMessage.jsx';
import AIChatCommandCard from './AIChatCommandCard.jsx';
import AIChatToolCard from './AIChatToolCard.jsx';

const streamSourceTextKey = '我会先流式输出分析结论,待流式完成后再解析成工具调用,然后进入审批,再开始执行工具.';
const parsedToolCode = `<read_file>
<args>
  <file>
    <path>frontend/src/components/AIPanel.jsx</path>
  </file>
  <file>
    <path>frontend/src/components/ai/chat/AIChatConversation.jsx</path>
  </file>
</args>
</read_file>`;

export default function AIChatStreamingLifecycle() {
  const { t } = useTranslation();
  const streamSourceText = t(streamSourceTextKey);
  const [phase, setPhase] = useState('streaming');
  const [visibleLength, setVisibleLength] = useState(0);

  useEffect(() => {
    if (phase !== 'streaming') {
      return undefined;
    }
    if (visibleLength >= streamSourceText.length) {
      const timer = window.setTimeout(() => setPhase('tool'), 700);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setVisibleLength((current) => Math.min(current + 3, streamSourceText.length));
    }, 45);
    return () => window.clearTimeout(timer);
  }, [phase, visibleLength]);

  useEffect(() => {
    if (phase === 'tool') {
      const timer = window.setTimeout(() => setPhase('approval'), 1100);
      return () => window.clearTimeout(timer);
    }
    if (phase === 'approval') {
      const timer = window.setTimeout(() => setPhase('execute'), 1100);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  const streamingText = useMemo(() => {
    const content = streamSourceText.slice(0, visibleLength);
    if (phase === 'streaming' && visibleLength < streamSourceText.length) {
      return `${content}▍`;
    }
    return content;
  }, [phase, visibleLength]);

  if (phase === 'streaming') {
    return (
      <AIChatAssistantMessage
        time={t('刚刚')}
        text={streamingText}
        metrics={[`${t('首字')} 2.0s`, '4.3s', '18.8 tok/s']}
      />
    );
  }

  if (phase === 'tool') {
    return (
      <AIChatToolCard
        actionLabel="read_file"
        title={t('解析工具')}
        summary={t('等待流式完成后解析出的目标工具')}
        code={parsedToolCode}
        status="已解析"
      />
    );
  }

  if (phase === 'approval') {
    return (
      <AIChatApprovalCard
        title={t('审批工具')}
        summary={t('已识别出工具调用,请批准继续执行该工具.')}
      />
    );
  }

  return (
    <AIChatCommandCard
      purpose={t('执行工具')}
      command="read_file ./frontend/src/components/AIPanel.jsx ./frontend/src/components/ai/chat/AIChatConversation.jsx"
      output={t('正在执行...\n已读取目标文件内容.\n下一步可进入结构化编辑.')}
      status="执行中"
    />
  );
}