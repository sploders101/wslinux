import {
    FsError,
	IdbFs,
} from "./idbfs";
import { NodeStat } from "./idbfs/types";
import { PacketBuilder, PacketReader } from "./packetizers";

/*

Protocol notes:

* All chunks are written by classes within packetizers.ts or their Rust equivalent
* Visually-depicted packets will include types as referenced by packetizers
* All multi-byte integer types are big endian
* Packetized buffers always have a leading u16 indicating their size
* All strings are utf-8 encoded, and serialized as packetized buffers
* Protocol follows a tree pattern. Each chunk may change behavior and interpretation of following chunks
* Type information IS NOT included in packets. Version must be negotiated prior

*/

const constants = {
	actions: {
		internals: 0,
		init: 1,
		destroy: 2,
		lookup: 3,
		forget: 4,
		batch_forget: 5,
		getattr: 6,
		setattr: 7,
		readlink: 8,
		mknod: 9,
		mkdir: 10,
		unlink: 11,
		rmdir: 12,
		symlink: 13,
		rename: 14,
		link: 15,
		open: 16,
		read: 17,
		write: 18,
		flush: 19,
		release: 20,
		fsync: 21,
		opendir: 22,
		readdir: 23,
		readdirplus: 24,
		releasedir: 25,
		fsyncdir: 26,
		statfs: 27,
		setxattr: 28,
		getxattr: 29,
		listxattr: 30,
		removexattr: 31,
		access: 32,
		create: 33,
		getlk: 34,
		setlk: 35,
		bmap: 36,
		ioctl: 37,
		poll: 38,
		fallocate: 39,
		lseek: 40,
		copy_file_range: 41,
		setvolname: 42,
		exchange: 43,
		getxtimes: 44,
	},
	internals: {
		version: 0,
		reply: 1,
	},
	replyTypes: {
		empty: 0,
		stat: 1,
	}
}

/**
 * Responds to a message with a nodestat message
 */
export async function respondStat(responseId: number, ws: WebSocket, stat: NodeStat) {
    // [response_type: u8][response_id: u16]
    // [ino: u64][size: u64][blocks: u64][atimeMs: u64][mtimeMs: u64][ctimeMs: u64]
    // [crtimeMs: u64][mode: u32][nlink: u32][uid: u32][gid: u32][rdev: u32][blksize: u32]
    const packet = new PacketBuilder();
    packet.u8(constants.internals.reply);
    packet.u16(responseId);
    packet.u64(BigInt(stat.ino));
    packet.u64(BigInt(stat.size));
    packet.u64(BigInt(stat.blocks));
    packet.u64(BigInt(stat.atimeMs));
    packet.u64(BigInt(stat.mtimeMs));
    packet.u64(BigInt(stat.ctimeMs));
    packet.u64(BigInt(stat.crtimeMs));
    packet.u32(stat.mode);
    packet.u32(stat.nlink);
    packet.u32(stat.uid);
    packet.u32(stat.gid);
    packet.u32(stat.rdev);
    packet.u32(stat.blksize);
    ws.send(packet.getPacket());
}

/**
 * Calls lookup function
 *
 * `[response_id: u16][parent_inode: u64][name: string]`
 */
export async function callLookup(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = data.u64();
	// Inodes cannot be higher than ${Number.MAX_SAFE_INTEGER} due to IDB key limitations.
	if (parent > Number.MAX_SAFE_INTEGER) throw new FsError("No such file or directory");
	const name = data.string();

	const stat = await fs.lookup(Number(parent), name);

	respondStat(responseId, ws, stat);
}

export function connectFilesystem(ws: WebSocket, fs: IdbFs) {
	ws.addEventListener("message", async (event) => {
		const packet = new PacketReader(new Uint8Array(await (event.data as Blob).arrayBuffer()))

		// First byte dictates the function we're calling.
		const function_id = packet.u8();
		switch (function_id) {
			case constants.actions.internals: return;
			case constants.actions.init: return;
			case constants.actions.destroy: return;
			case constants.actions.lookup: return callLookup(fs, ws, packet);
			case constants.actions.forget: return;
			case constants.actions.batch_forget: return;
			case constants.actions.getattr: return;
			case constants.actions.setattr: return;
			case constants.actions.readlink: return;
			case constants.actions.mknod: return;
			case constants.actions.mkdir: return;
			case constants.actions.unlink: return;
			case constants.actions.rmdir: return;
			case constants.actions.symlink: return;
			case constants.actions.rename: return;
			case constants.actions.link: return;
			case constants.actions.open: return;
			case constants.actions.read: return;
			case constants.actions.write: return;
			case constants.actions.flush: return;
			case constants.actions.release: return;
			case constants.actions.fsync: return;
			case constants.actions.opendir: return;
			case constants.actions.readdir: return;
			case constants.actions.readdirplus: return;
			case constants.actions.releasedir: return;
			case constants.actions.fsyncdir: return;
			case constants.actions.statfs: return;
			case constants.actions.setxattr: return;
			case constants.actions.getxattr: return;
			case constants.actions.listxattr: return;
			case constants.actions.removexattr: return;
			case constants.actions.access: return;
			case constants.actions.create: return;
			case constants.actions.getlk: return;
			case constants.actions.setlk: return;
			case constants.actions.bmap: return;
			case constants.actions.ioctl: return;
			case constants.actions.poll: return;
			case constants.actions.fallocate: return;
			case constants.actions.lseek: return;
			case constants.actions.copy_file_range: return;
			case constants.actions.setvolname: return;
			case constants.actions.exchange: return;
			case constants.actions.getxtimes: return;
			default: console.error("Received invalid request", function_id);
		}
	});
}
