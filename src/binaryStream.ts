export class BinaryStream {
  private pos = 0;
  private chunks: Buffer[] = [];
  private readonly buffer: Buffer | undefined;

  constructor(buffer?: Buffer) {
    this.buffer = buffer;
    if (buffer) {
      this.chunks.push(buffer);
    }
  }

  // Readers
  readByte(): number {
    if (!this.buffer) throw new Error('BinaryStream is in write mode');
    const value = this.buffer.readUInt8(this.pos);
    this.pos += 1;
    return value;
  }

  readUInt32LE(): number {
    if (!this.buffer) throw new Error('BinaryStream is in write mode');
    const value = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  readBigUInt64BE(): bigint {
    if (!this.buffer) throw new Error('BinaryStream is in write mode');
    const value = this.buffer.readBigUInt64BE(this.pos);
    this.pos += 8;
    return value;
  }

  readString(length: number): string {
    if (!this.buffer) throw new Error('BinaryStream is in write mode');
    const value = this.buffer.subarray(this.pos, this.pos + length).toString('utf8');
    this.pos += length;
    return value;
  }

  readRemaining(): Buffer {
    if (!this.buffer) throw new Error('BinaryStream is in write mode');
    const value = this.buffer.subarray(this.pos);
    this.pos = this.buffer.length;
    return value;
  }

  // Writers
  writeByte(value: number): void {
    const byte = Buffer.allocUnsafe(1);
    byte.writeUInt8(value & 0xff);
    this.chunks.push(byte);
  }

  writeUInt32LE(value: number): void {
    const bytes = Buffer.allocUnsafe(4);
    bytes.writeUInt32LE(value >>> 0);
    this.chunks.push(bytes);
  }

  writeBigUInt64BE(value: bigint): void {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeBigUInt64BE(value);
    this.chunks.push(bytes);
  }

  writeString(value: string, maxLength: number): void {
    const name = Buffer.from(value, 'utf8').subarray(0, maxLength);
    const length = Buffer.allocUnsafe(1);
    length.writeUInt8(name.length);
    const padding = Buffer.alloc(maxLength - name.length);
    this.chunks.push(length, name, padding);
  }

  writeBuffer(value: Buffer): void {
    this.chunks.push(value);
  }

  getBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
