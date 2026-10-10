// Reassembles the original GLB bytes; geometry and textures are unchanged.
export async function loadChunkedGltf(loader, manifestUrl, onLoad, onProgress, onError) {
  try {
    const manifestAddress = new URL(manifestUrl, globalThis.location?.href);
    const response = await fetch(manifestAddress);
    if (!response.ok) throw new Error(`模型清单读取失败：HTTP ${response.status}`);
    const manifest = await response.json();
    if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 12 || !Array.isArray(manifest.chunks) || !manifest.chunks.length) {
      throw new Error('模型清单无效');
    }
    const declaredBytes = manifest.chunks.reduce((sum, chunk) => {
      if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || typeof chunk.file !== 'string') {
        throw new Error('模型分包清单无效');
      }
      return sum + chunk.bytes;
    }, 0);
    if (declaredBytes !== manifest.bytes) throw new Error('模型分包总长度不符');
    const buffer = new Uint8Array(manifest.bytes);
    let offset = 0;
    for (const chunk of manifest.chunks) {
      const chunkResponse = await fetch(new URL(chunk.file, manifestAddress));
      if (!chunkResponse.ok || !chunkResponse.body) throw new Error(`模型分包读取失败：HTTP ${chunkResponse.status}`);
      const reader = chunkResponse.body.getReader();
      let received = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (received + value.byteLength > chunk.bytes) throw new Error('模型分包长度超出清单');
          buffer.set(value, offset + received);
          received += value.byteLength;
          onProgress?.({ loaded: offset + received, total: manifest.bytes, lengthComputable: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (received !== chunk.bytes) throw new Error('模型分包下载不完整');
      offset += received;
    }
    if (new DataView(buffer.buffer).getUint32(0, true) !== 0x46546c67) throw new Error('模型格式无效');
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer.buffer, new URL('.', manifestAddress).href, resolve, reject);
    });
    onLoad(gltf);
  } catch (error) {
    if (onError) onError(error);
    else throw error;
  }
}
