// A ZIP writer in eighty lines. XLSX is a ZIP of XML, and the approved third
// party list (docs/02 §9) does not include an archiver — so this stores entries
// uncompressed (method 0), which is legal ZIP, readable by Excel, Numbers and
// LibreOffice, and needs no deflate implementation.

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = utf8(e.path);
    const sum = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // version needed
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // stored
    v.setUint16(10, 0, true); // time — fixed, so the same report bytes twice
    v.setUint16(12, 0x0021, true); // date — 1980-01-01; reproducible archives
    v.setUint32(14, sum, true);
    v.setUint32(18, e.data.length, true);
    v.setUint32(22, e.data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, e.data);

    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, 0, true);
    d.setUint16(12, 0, true);
    d.setUint16(14, 0x0021, true);
    d.setUint32(16, sum, true);
    d.setUint32(20, e.data.length, true);
    d.setUint32(24, e.data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + e.data.length;
  }

  const dirBytes = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirBytes.length, true);
  ev.setUint32(16, offset, true);

  return concat([...chunks, dirBytes, end]);
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
