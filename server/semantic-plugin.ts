import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { analyzeWithJev, normalizeSemanticInput, type JevConfig } from './jev';

function json(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function readBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 32 * 1024) throw new Error('请求体超过 32 KB');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function semanticPlugin(config: JevConfig): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0];
    if (path !== '/api/semantic/status' && path !== '/api/semantic/analyze') { next(); return; }
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) { json(res, 403, { error: '只接受同源请求' }); return; } }
      catch { json(res, 403, { error: 'Origin 无效' }); return; }
    }
    if (path.endsWith('/status') && req.method === 'GET') {
      json(res, 200, { configured: Boolean(config.apiKey.trim()), provider: 'OpenRouter · JEV', model: config.model }); return;
    }
    if (!path.endsWith('/analyze') || req.method !== 'POST') { json(res, 405, { error: '请求方法不支持' }); return; }
    if (!config.apiKey.trim()) { json(res, 503, { error: '本机未配置 OPENROUTER_API_KEY；修改 .env.local 后重启服务' }); return; }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) { json(res, 415, { error: '请使用 application/json' }); return; }
    let input;
    try { input = normalizeSemanticInput(await readBody(req)); }
    catch (error) { json(res, 400, { error: error instanceof Error ? error.message : '输入格式错误' }); return; }
    const cancel = new AbortController();
    const closed = () => { if (!res.writableEnded) cancel.abort(); };
    res.once('close', closed);
    try { json(res, 200, await analyzeWithJev(input, config, cancel.signal)); }
    catch (error) {
      if (cancel.signal.aborted) return;
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      json(res, timedOut ? 504 : 502, { error: timedOut ? 'JEV 分析超时，请重试；当前表情继续运行' : error instanceof Error ? error.message : 'JEV 分析失败' });
    } finally { res.off('close', closed); }
  };
  return { name: 'soullink-jev-semantic', configureServer: server => { server.middlewares.use(middleware); }, configurePreviewServer: server => { server.middlewares.use(middleware); } };
}
