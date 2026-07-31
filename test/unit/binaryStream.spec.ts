import { describe, expect, it } from 'vitest';

import { BinaryStream } from '../../src/binaryStream';

describe('BinaryStream', () => {
  it('round-trips a uint32 little-endian value', () => {
    const stream = new BinaryStream();
    stream.writeUInt32LE(0xdeadbeef);
    const read = new BinaryStream(stream.getBuffer());
    expect(read.readUInt32LE()).toBe(0xdeadbeef);
  });

  it('round-trips a uint64 big-endian value', () => {
    const stream = new BinaryStream();
    stream.writeBigUInt64BE(0x7d2725b1a0527026n);
    const read = new BinaryStream(stream.getBuffer());
    expect(read.readBigUInt64BE()).toBe(0x7d2725b1a0527026n);
  });

  it('writes and reads single bytes', () => {
    const stream = new BinaryStream();
    stream.writeByte(0xff);
    stream.writeByte(0x00);
    stream.writeByte(0x80);
    const read = new BinaryStream(stream.getBuffer());
    expect(read.readByte()).toBe(0xff);
    expect(read.readByte()).toBe(0x00);
    expect(read.readByte()).toBe(0x80);
  });

  it('writeString pads the name with null bytes to maxLength', () => {
    const stream = new BinaryStream();
    stream.writeString('ab', 4);
    const buf = stream.getBuffer();
    expect(buf.length).toBe(5);
    expect(buf[0]).toBe(2);
    expect(buf.subarray(1, 3).toString('utf8')).toBe('ab');
    expect(buf[3]).toBe(0);
    expect(buf[4]).toBe(0);
  });

  it('writeString truncates names longer than maxLength', () => {
    const stream = new BinaryStream();
    stream.writeString('x'.repeat(10), 4);
    const buf = stream.getBuffer();
    expect(buf.length).toBe(5);
    expect(buf[0]).toBe(4);
    expect(buf.subarray(1).every((byte) => byte === 0x78)).toBe(true);
  });

  it('readRemaining returns the rest of the buffer', () => {
    const stream = new BinaryStream(Buffer.from([1, 2, 3, 4, 5]));
    expect(stream.readByte()).toBe(1);
    expect(stream.readRemaining()).toEqual(Buffer.from([2, 3, 4, 5]));
  });
});
