import { splitTrailingIncompleteEscapeSequence } from '../../utils/terminalHelpers.ts';

function skipEscapeSequence(text: string, startIndex: number): number {
  let j = startIndex + 1;
  if (j >= text.length) return j;
  if (text[j] === '[') {
    // CSI 序列
    j++;
    while (j < text.length) {
      const c = text.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7E) { j++; break; }
      j++;
    }
  } else if (text[j] === ']') {
    // OSC 序列 (如 Window Title)
    j++;
    while (j < text.length) {
      if (text[j] === '\x07') { j++; break; }
      if (text[j] === '\x1b' && j + 1 < text.length && text[j+1] === '\\') { j += 2; break; }
      j++;
    }
  } else {
    // 其他 ESC 序列（跳过后面一个字符）
    j++;
  }
  return j;
}

// 本地回显预测过滤：记录 onData 推入的预测回显字符，在 onmessage 中匹配并丢弃
// 服务器回显，遇到脱轨输出时清空预测队列。状态机从 Terminal.tsx 原样搬移。
export function createTerminalLocalEchoFilter() {
  const pendingEchoes: string[] = [];
  let predictiveDecoder = new TextDecoder();
  let predictiveTextCarry = '';

  return {
    // 与原 shouldFilterIncomingText 表达式一致：有预测回显待过滤或上帧有残留转义序列
    shouldFilterIncomingText(localEchoEnabled: boolean) {
      return (localEchoEnabled && pendingEchoes.length > 0) || predictiveTextCarry.length > 0;
    },
    // 快速路径：重置流式解码与残留 carry（不清空预测队列，与原实现一致）
    noteFastPath() {
      predictiveDecoder = new TextDecoder();
      predictiveTextCarry = '';
    },
    decodeStream(bytes: Uint8Array) {
      return predictiveDecoder.decode(bytes, { stream: true });
    },
    pushPendingEcho(ch: string) {
      pendingEchoes.push(ch);
    },
    // 返回过滤后文本；整帧不完整（无完整字符可写）时返回 null
    filterIncoming(text: string): string | null {
      if (predictiveTextCarry) {
        text = predictiveTextCarry + text;
        predictiveTextCarry = '';
      }

      const splitText = splitTrailingIncompleteEscapeSequence(text);
      predictiveTextCarry = splitText.carry;
      text = splitText.complete;
      if (!text) {
        return null;
      }

      let i = 0;
      const parts = [];

      while (i < text.length) {
        // 1. 强大且健壮的 ANSI 转义序列跳过逻辑 (CSI、OSC 及其他单字符转义)
        if (text[i] === '\x1b') {
          if (i + 1 >= text.length) { parts.push(text[i]); i++; continue; }
          const nextIndex = skipEscapeSequence(text, i);
          parts.push(text.substring(i, nextIndex));
          i = nextIndex;
          continue;
        }

        // 2. 匹配回显字符并丢弃
        if (pendingEchoes.length > 0) {
          const expected = pendingEchoes[0];
          if (text[i] === expected) {
            pendingEchoes.shift();
            i++;
            continue;
          }
          if (expected === '\x7F' && text[i] === '\b') {
            pendingEchoes.shift();
            i++;
            continue;
          }
          // 遇到非打印控制字符（如 \r, \n, \x07 等），直接放行打印，不破坏当前的预测队列
          const charCode = text.charCodeAt(i);
          if (charCode < 32 || charCode === 127) {
            parts.push(text[i]);
            i++;
            continue;
          }
        }

        // 真正的冲突（服务器发来了与预测不符的可打印字符），视为脱轨，清空队列并接受服务器输出
        pendingEchoes.length = 0;
        parts.push(text[i]);
        i++;
      }

      // 写回经过滤的文本
      return parts.join('');
    },
  };
}
