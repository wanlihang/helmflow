/**
 * 客户端 SSE 解析工具。
 * 处理 \n\n 和 \r\n\r\n 两种分隔符。
 */

/**
 * 将 SSE chunk 解析为独立的 "data: ..." 行。
 * 处理 CRLF (\r\n) 和 LF (\n) 两种行尾。
 * 返回 { lines: 解析出的完整 SSE 消息, remainder: 不完整的尾部 }。
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { messages: string[]; remainder: string } {
  const combined = buffer + chunk.replace(/\r\n/g, "\n");
  // SSE messages are separated by blank lines (\n\n)
  const parts = combined.split("\n\n");
  const remainder = parts.pop() ?? "";
  const messages = parts.filter((p) => p.trim().length > 0);
  return { messages, remainder };
}

/**
 * 从 SSE 消息中提取 data 字段的 JSON 内容。
 * 支持 "data: ..." 和 "data: ...\nid: ..." 格式。
 */
export function extractSseData(message: string): string | null {
  const lines = message.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      return line.slice(6);
    }
  }
  return null;
}
