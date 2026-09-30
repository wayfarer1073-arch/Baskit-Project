/**
 * xlsx는 zip 파일이다. 압축을 풀기 전에 zip 목록(central directory)에 적힌 원래 크기를 더해,
 * 작은 파일이 풀리면서 메모리를 다 쓰게 만드는 "압축 폭탄"을 걸러낸다.
 * zip이 아니면 null, 목록을 읽을 수 없거나 zip64(4GB 이상 표기)면 Infinity를 돌려준다.
 */
export function zipUncompressedSize(buffer: Buffer): number | null {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  try {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return Infinity;
    const entries = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (entries === 0xffff || offset === 0xffffffff) return Infinity;
    let total = 0;
    for (let n = 0; n < entries; n++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) return Infinity;
      const size = buffer.readUInt32LE(offset + 24);
      if (size === 0xffffffff) return Infinity;
      total += size;
      offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
    return total;
  } catch {
    return Infinity;
  }
}
