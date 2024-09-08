import { IdbFs } from "../idbfs";
import { PacketReader } from "../packetizers";
import * as respond from "./responses";

export async function lookup(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = Number(data.u64());
	const name = data.string();

	const { attr, generation } = await fs.lookup(parent, name);
	respond.entry(responseId, ws, attr, generation);
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
	respond.attr(responseId, ws, attr);
}

export async function setattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
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
	respond.attr(responseId, ws, attr);
}
