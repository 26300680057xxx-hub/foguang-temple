// Small concurrent chunks, resumable verified cache, and bounded network retries.
const CACHE = 'foguang-model-chunks-v2';
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
async function matches(bytes, chunk) {
  if (bytes.byteLength !== chunk.bytes) return false;
  if (chunk.sha256 && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === chunk.sha256;
  }
  return true;
}
async function fetchBytes(url, { signal, idleMs, onData, expectedBytes }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(abort, idleMs); };
  arm();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer()); onData?.(bytes.length); return bytes;
    }
    const reader = response.body.getReader(), pieces = [];
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        arm(); received += value.byteLength;
        if (expectedBytes && received > expectedBytes) throw new Error('分包长度超出清单');
        pieces.push(value); onData?.(received);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result = new Uint8Array(received); let offset = 0;
    for (const piece of pieces) { result.set(piece, offset); offset += piece.length; }
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export async function loadChunkedGltf(loader, manifestUrl, onLoad, onProgress, onError, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  const signal = controller.signal;
  try {
    const address = new URL(manifestUrl, globalThis.location?.href);
    let manifest, lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const bytes = await fetchBytes(address, { signal, idleMs: options.timeoutMs || 20000 });
        manifest = JSON.parse(new TextDecoder().decode(bytes)); break;
      } catch (error) {
        lastError = error; if (signal.aborted || attempt === 2) throw error;
        await sleep(400 * (attempt + 1), signal);
      }
    }
    if (!manifest) throw lastError;
    if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 12 || manifest.bytes > 1024 ** 3 ||
        !Array.isArray(manifest.chunks) || !manifest.chunks.length) throw new Error('模型清单无效');
    const starts = []; let total = 0;
    for (const chunk of manifest.chunks) {
      if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || typeof chunk.file !== 'string') throw new Error('模型分包清单无效');
      starts.push(total); total += chunk.bytes;
    }
    if (total !== manifest.bytes) throw new Error('模型分包总长度不符');
    let cache = null;
    try { if (globalThis.caches) cache = await caches.open(CACHE); } catch { /* Private browsing and quotas cannot block exploration. */ }
    const buffer = new Uint8Array(total), progress = new Array(starts.length).fill(0);
    const notify = phase => onProgress?.({ loaded: progress.reduce((a,b) => a+b, 0), total, lengthComputable: true, phase });
    let next = 0;
    async function worker() {
      while (next < manifest.chunks.length) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const index = next++, chunk = manifest.chunks[index];
        const url = new URL(chunk.file, address);
        if (chunk.sha256) url.searchParams.set('v', chunk.sha256);
        let bytes = null;
        try {
          const saved = await cache?.match(url);
          if (saved) { const cached = new Uint8Array(await saved.arrayBuffer()); if (await matches(cached, chunk)) bytes = cached; else await cache.delete(url); }
        } catch { /* Cache access is optional. */ }
        if (!bytes) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const sources = [...(manifest.mirrors || []).map(base => new URL(chunk.file, base)), url];
              const race = new AbortController();
              const stop = () => race.abort();
              signal.addEventListener('abort', stop, { once: true });
              const receivedBySource = sources.map(() => 0);
              try {
                bytes = await Promise.any(sources.map(async (source, i) => {
                  if (i) await sleep(1800 * i, race.signal);
                  const result = await fetchBytes(source, { signal: race.signal, idleMs: options.timeoutMs || 20000, expectedBytes: chunk.bytes,
                    onData: received => { receivedBySource[i] = received; progress[index] = Math.max(...receivedBySource); notify('download'); } });
                  if (!(await matches(result, chunk))) throw new Error('模型分包校验失败');
                  return result;
                }));
              } finally { race.abort(); signal.removeEventListener('abort', stop); }
              break;
            } catch (error) {
              bytes = null; progress[index] = 0;
              if (signal.aborted || attempt === 2) throw error;
              notify('retry'); await sleep(500 * (attempt + 1), signal);
            }
          }
          try { await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* Storage full: still show the model. */ }
        }
        buffer.set(bytes, starts[index]); progress[index] = bytes.byteLength; notify('download');
      }
    }
    await Promise.all(Array.from({ length: Math.min(options.concurrency || 3, manifest.chunks.length) }, worker));
    notify('decode');
    let modelBuffer = buffer.buffer;
    if (manifest.compression === 'gzip') {
      if (!globalThis.DecompressionStream) throw new Error('当前浏览器不支持压缩模型，请选择兼容版本');
      modelBuffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if (modelBuffer.byteLength !== manifest.uncompressedBytes || !(await matches(new Uint8Array(modelBuffer), { bytes: manifest.uncompressedBytes, sha256: manifest.decodedSha256 }))) throw new Error('模型解压校验失败');
    }
    if (new DataView(modelBuffer).getUint32(0, true) !== 0x46546c67) throw new Error('模型格式无效');
    const gltf = await new Promise((resolve, reject) => loader.parse(modelBuffer, new URL('.', address).href, resolve, reject));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // Await asynchronous scene preparation so its failures reach the retry UI too.
    await onLoad(gltf);
  } catch (error) {
    controller.abort();
    if (onError) onError(error); else throw error;
  } finally { options.signal?.removeEventListener('abort', abort); }
}
