import { IdbFs } from "./idbfs";
import { PacketReader } from "./packetizers";
import { constants } from "./wsfs-proto/constants";
import * as proc from "./wsfs-proto/procedures";

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

export function connectFilesystem(ws: WebSocket, fs: IdbFs) {
	ws.addEventListener("message", (event) => {
		(event.data as Blob).arrayBuffer()
			.then((data) => {
				const packet = new PacketReader(new Uint8Array(data));

				// First byte dictates the function we're calling.
				const function_id = packet.u8();
				switch (function_id) {
					case constants.actions.internals: return;
					case constants.actions.init: return;
					case constants.actions.destroy: return;
					case constants.actions.lookup: return proc.lookup(fs, ws, packet);
					case constants.actions.forget: return;
					case constants.actions.batch_forget: return;
					case constants.actions.getattr: return proc.getattr(fs, ws, packet);
					case constants.actions.setattr: return proc.setattr(fs, ws, packet);
					case constants.actions.readlink: return proc.readlink(fs, ws, packet);
					case constants.actions.mknod: return proc.mknod(fs, ws, packet);
					case constants.actions.mkdir: return proc.mkdir(fs, ws, packet);
					case constants.actions.unlink: return proc.unlink(fs, ws, packet);
					case constants.actions.rmdir: return proc.rmdir(fs, ws, packet);
					case constants.actions.symlink: return proc.symlink(fs, ws, packet);
					case constants.actions.rename: return proc.rename(fs, ws, packet);
					case constants.actions.link: return proc.link(fs, ws, packet);
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
	});
}
