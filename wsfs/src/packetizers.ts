/**
 * Builds a packet in chunks using an internal cursor
 */
export class PacketBuilder {
	private _length: number;
	private _buf: Uint8Array;
	private _dv: DataView;
	private _cursor: number;

	constructor(prealloc: number = 512) {
		this._length = prealloc;
		this._buf = new Uint8Array(prealloc);
		this._dv = new DataView(this._buf.buffer);
		this._cursor = 0;
	}

	private _alloc(neededSpace: number) {
		if (this._buf.length < this._cursor + neededSpace) {
			if (this._buf.length === 0) {
				throw new Error("Cannot use PacketBuilder after calling getPacket");
			}
			let newLength = this._buf.length;
			while (newLength < this._cursor + neededSpace) {
				newLength += newLength * 2;
			}
			const newBuf = new Uint8Array(newLength);
			newBuf.set(this._buf, 0);
			this._buf = newBuf;
			this._dv = new DataView(newBuf.buffer);
		}
		this._length += neededSpace;
	}

	u8(value: number) {
		this._alloc(1);
		this._dv.setUint8(this._cursor, value);
		this._cursor += 1;
	}
	u16(value: number) {
		this._alloc(2);
		this._dv.setUint16(this._cursor, value, false);
		this._cursor += 2;
	}
	u32(value: number) {
		this._alloc(4);
		this._dv.setUint32(this._cursor, value, false);
		this._cursor += 4;
	}
	u64(value: bigint) {
		this._alloc(8);
		this._dv.setBigUint64(this._cursor, value, false);
		this._cursor += 4;
	}
	i8(value: number) {
		this._alloc(1);
		this._dv.setInt8(this._cursor, value);
		this._cursor += 1;
	}
	i16(value: number) {
		this._alloc(2);
		this._dv.setInt16(this._cursor, value, false);
		this._cursor += 2;
	}
	i32(value: number) {
		this._alloc(4);
		this._dv.setInt32(this._cursor, value, false);
		this._cursor += 4;
	}
	i64(value: bigint) {
		this._alloc(8);
		this._dv.setBigInt64(this._cursor, value, false);
		this._cursor += 4;
	}

	buffer(value: Uint8Array) {
		this._alloc(2 + value.length);
		this.u16(value.length);
		this._buf.set(value, this._cursor);
		this._cursor += value.length; // Already advanced 2 from this.u16
	}
	string(value: string) {
		const encodedString = new TextEncoder().encode(value);
		this.buffer(encodedString);
	}

	/**
	 * Gets the completed packet
	 * @param compress Copies the data into a perfectly-sized buffer to save memory.
	 */
	getPacket(compress: boolean = false) {
		const slice = this._buf.slice(0, this._length);
		// Now we can drop the internal buffer
		this._buf = new Uint8Array(0);
		this._dv = new DataView(this._buf.buffer);
		if (compress) {
			const newBuf = new Uint8Array(this._length);
			newBuf.set(slice);
			// No more references to old buffer after this return, so the memory will be GC'd
			return newBuf;
		}
		return slice;
	}
}

/**
 * Reads a packet in chunks using an internal cursor
 */
export class PacketReader {
	private _buf: Uint8Array;
	private _dv: DataView;
	private _cursor: number;

	constructor(packet: Uint8Array) {
		this._buf = packet;
		this._dv = new DataView(packet.buffer);
		this._cursor = 0;
	}

	u8() {
		const num = this._dv.getUint8(this._cursor);
		this._cursor += 1;
		return num;
	}
	u16() {
		const num = this._dv.getUint16(this._cursor, false);
		this._cursor += 2;
		return num;
	}
	u32() {
		const num = this._dv.getUint32(this._cursor, false);
		this._cursor += 4;
		return num;
	}
	u64() {
		const num = this._dv.getBigUint64(this._cursor, false);
		this._cursor += 8;
		return num;
	}
	i8() {
		const num = this._dv.getInt8(this._cursor);
		this._cursor += 1;
		return num;
	}
	i16() {
		const num = this._dv.getInt16(this._cursor, false);
		this._cursor += 2;
		return num;
	}
	i32() {
		const num = this._dv.getInt32(this._cursor, false);
		this._cursor += 4;
		return num;
	}
	i64() {
		const num = this._dv.getBigInt64(this._cursor, false);
		this._cursor += 8;
		return num;
	}

	buffer() {
		const bufSize = this.u16();
		const buf = this._buf.slice(this._cursor, this._cursor + bufSize);
		this._cursor += bufSize; // Cursor already advanced 2 for size header in this.readU16
		return buf;
	}
	string() {
		const buf = this.buffer();
		return new TextDecoder().decode(buf);
	}
}
