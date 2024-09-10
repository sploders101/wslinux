import { IdbFs } from "../idbfs";
import { PacketReader } from "../packetizers";
import * as respond from "./responses";

export async function lookup(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = Number(data.u64());
	const name = data.string();

	const entry = await fs.lookup(parent, name);
	respond.entry(ws, responseId, entry);
}

export async function forget(fs: IdbFs, data: PacketReader) {
	const ino = Number(data.u64());
	let nlookup = data.u64();

	while (nlookup > BigInt(Number.MAX_SAFE_INTEGER)) {
		await fs.forget(Number(ino), Number.MAX_SAFE_INTEGER);
		nlookup -= BigInt(Number.MAX_SAFE_INTEGER);
	}
	await fs.forget(Number(ino), Number(nlookup));
}

export async function getattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());

	const attr = await fs.getattr(ino);
	respond.attr(ws, responseId, attr);
}

export async function setattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	// Types continue through while loop using `[type: u8][value: ?]` pairs

	let mode: number | null = null;
	let uid: number | null = null;
	let gid: number | null = null;
	let size: number | null = null;
	let mtimeMs: number | null = null;
	let ctimeMs: number | null = null;
	let crtimeMs: number | null = null;

	let nextType = data.u8();
	while (nextType !== 0) {
		switch (nextType) {
			case 1: // mode
				mode = data.u32();
				break;
			case 2: // uid
				uid = data.u32();
				break;
			case 3: // gid
				gid = data.u32();
				break;
			case 4: // size
				size = Number(data.u64());
				break;
			case 5: // mtime
				mtimeMs = Number(data.u64());
				break;
			case 6: // ctime
				ctimeMs = Number(data.u64());
				break;
			case 7: // crtime
				crtimeMs = Number(data.u64());
				break;
		}
		nextType = data.u8();
	}

	const attr = await fs.setattr(ino, mode, uid, gid, size, mtimeMs, ctimeMs, crtimeMs);
	respond.attr(ws, responseId, attr);
}

export async function readlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());

	const target = await fs.readlink(ino);
	respond.data(ws, responseId, target);
}

export async function mknod(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const uid = data.u32();
	const gid = data.u32();
	const parentIno = Number(data.u64());
	const name = data.string();
	const mode = data.u32();
	const umask = data.u32();
	const rdev = data.u32();

	const entry = await fs.mknod(uid, gid, parentIno, name, mode, umask, rdev);
	respond.entry(ws, responseId, entry);
}

export async function mkdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const uid = data.u32();
	const gid = data.u32();
	const parentIno = Number(data.u64());
	const name = data.string();
	const mode = data.u32();

	const entry = await fs.mkdir(uid, gid, parentIno, name, mode);
	respond.entry(ws, responseId, entry);
}

export async function unlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parentIno = Number(data.u64());
	const name = data.string();

	await fs.unlink(parentIno, name);
	respond.empty(ws, responseId);
}

export async function rmdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parentIno = Number(data.u64());
	const name = data.string();

	await fs.rmdir(parentIno, name);
	respond.empty(ws, responseId);
}

export async function symlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const uid = data.u32();
	const gid = data.u32();
	const parentIno = Number(data.u64());
	const name = data.string();
	const target = data.string();

	const entry = await fs.symlink(uid, gid, parentIno, name, target);
	respond.entry(ws, responseId, entry);
}

export async function rename(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = Number(data.u64());
	const name = data.string();
	const newParent = Number(data.u64());
	const newName = data.string();
	const flags = data.u32(); // Reserved. May need it later

	await fs.rename(parent, name, newParent, newName, flags);
	respond.empty(ws, responseId);
}

export async function link(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const newParent = Number(data.u64());
	const newName = data.string();

	const entry = await fs.link(ino, newParent, newName);
	respond.entry(ws, responseId, entry);
}

export async function open(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const flags = data.i32();

	const openResponse = await fs.open(ino, flags);
	respond.open(ws, responseId, openResponse);
}

export async function read(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const offset = Number(data.i64());
	const size = data.u32();
	const flags = data.i32();

	const readData = await fs.read(ino, fh, offset, size, flags);
	respond.data(ws, responseId, readData);
}

export async function write(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
    const ino = Number(data.u64());
    const fh = Number(data.u64());
    const offset = Number(data.i64());
    const writeData = data.buffer();
    const write_flags = data.u32();
    const flags = data.i32();

	const bytesWritten = await fs.write(ino, fh, offset, writeData, write_flags, flags);
	respond.write(ws, responseId, bytesWritten);
}

export async function release(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
    const ino = Number(data.u64());
    const fh = Number(data.u64());
    const flags = data.i32();

    await fs.release(ino, fh, flags);
	respond.empty(ws, responseId);
}

export async function opendir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const flags = data.i32();

	const openData = await fs.opendir(ino, flags);
	respond.open(ws, responseId, openData);
}

export async function readdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const offset = Number(data.i64());

	const openData = await fs.readdir(ino, fh);
	respond.readdir(ws, responseId, openData.slice(offset));
}

export async function releasedir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
    const ino = Number(data.u64());
    const fh = Number(data.u64());
    const flags = data.i32();

    await fs.releasedir(ino, fh, flags);
    respond.empty(ws, responseId);
}
