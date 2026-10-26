function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {value ^= byte; for (let bit=0;bit<8;bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;}
  return (value ^ 0xffffffff) >>> 0;
}
function zipBuffer(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data || '');
    const header = Buffer.alloc(30), directory = Buffer.alloc(46), flags = entry.flags || 0;
    header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(flags,6);
    header.writeUInt32LE(crc32(data),14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50,0); directory.writeUInt16LE(0x0314,4); directory.writeUInt16LE(20,6); directory.writeUInt16LE(flags,8);
    directory.writeUInt32LE(crc32(data),16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(data.length,24); directory.writeUInt16LE(name.length,28);
    directory.writeUInt32LE(((entry.mode || (entry.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0,38); directory.writeUInt32LE(offset,42);
    local.push(header,name,data); central.push(directory,name); offset += header.length + name.length + data.length;
  }
  const directories = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directories.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directories,end]);
}

module.exports={zipBuffer};
