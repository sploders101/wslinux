import { FsError, IdbFs } from "../idbfs";
import { ErrorCode } from "../idbfs/errors";
import { PacketReader } from "../packetizers";
import { constants } from "./constants";
import * as respond from "./responses";

const debug = !!localStorage.getItem("debug-mode");
declare global {
    interface Window { activeRequests: Map<number, [string, any]>; }
}
window.activeRequests = new Map();

function audit(name: string, args: any) {
	if (debug) {
		console.log(name, args);
	}
}

function auditRequest(name: string, responseId: number, args: any) {
	audit(name, { responseId, ...args });
	window.activeRequests.set(responseId, [name, args]);
}

export async function lookup(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = Number(data.u64());
	const name = data.string();
	auditRequest("lookup", responseId, { parent, name });

	try {
		const entry = await fs.lookup(parent, name);
		respond.entry(ws, responseId, entry);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function forget(fs: IdbFs, data: PacketReader) {
	const ino = Number(data.u64());
	let nlookup = data.u64();
	audit("forget", { ino, nlookup });

	while (nlookup > BigInt(Number.MAX_SAFE_INTEGER)) {
		await fs.forget(Number(ino), Number.MAX_SAFE_INTEGER);
		nlookup -= BigInt(Number.MAX_SAFE_INTEGER);
	}
	await fs.forget(Number(ino), Number(nlookup));
}

export async function getattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	auditRequest("getattr", responseId, { ino });

	try {
		const attr = await fs.getattr(ino);
		respond.attr(ws, responseId, attr);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
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
	auditRequest("setattr", responseId, { ino, mode, uid, gid, size, mtimeMs, ctimeMs, crtimeMs });

	try {
		const attr = await fs.setattr(ino, mode, uid, gid, size, mtimeMs, ctimeMs, crtimeMs);
		respond.attr(ws, responseId, attr);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function readlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	auditRequest("readlink", responseId, { ino });

	try {
		const target = await fs.readlink(ino);
		respond.data(ws, responseId, target);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
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
	auditRequest("mknod", responseId, { uid, gid, parentIno, name, mode, umask, rdev});

	try {
		const entry = await fs.mknod(uid, gid, parentIno, name, mode, umask, rdev);
		respond.entry(ws, responseId, entry);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function mkdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const uid = data.u32();
	const gid = data.u32();
	const parentIno = Number(data.u64());
	const name = data.string();
	const mode = data.u32();
	auditRequest("mkdir", responseId, { uid, gid, parentIno, name, mode });

	try {
		const entry = await fs.mkdir(uid, gid, parentIno, name, mode);
		respond.entry(ws, responseId, entry);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function unlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parentIno = Number(data.u64());
	const name = data.string();
	auditRequest("unlink", responseId, { parentIno, name });

	try {
		await fs.unlink(parentIno, name);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function rmdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parentIno = Number(data.u64());
	const name = data.string();
	auditRequest("rmdir", responseId, { parentIno, name });

	try {
		await fs.rmdir(parentIno, name);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function symlink(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const uid = data.u32();
	const gid = data.u32();
	const parentIno = Number(data.u64());
	const name = data.string();
	const target = data.string();
	auditRequest("symlink", responseId, { uid, gid, parentIno, name, target });

	try {
		const entry = await fs.symlink(uid, gid, parentIno, name, target);
		respond.entry(ws, responseId, entry);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function rename(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const parent = Number(data.u64());
	const name = data.string();
	const newParent = Number(data.u64());
	const newName = data.string();
	const flags = data.u32(); // Reserved. May need it later
	auditRequest("rename", responseId, { parent, name, newParent, newName, flags});

	try {
		await fs.rename(parent, name, newParent, newName, flags);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function link(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const newParent = Number(data.u64());
	const newName = data.string();
	auditRequest("link", responseId, { ino, newParent, newName });

	try {
		const entry = await fs.link(ino, newParent, newName);
		respond.entry(ws, responseId, entry);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function open(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const flags = data.i32();
	auditRequest("open", responseId, { ino, flags });

	try {
		const openResponse = await fs.open(ino, flags);
		respond.open(ws, responseId, openResponse);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function read(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const offset = Number(data.i64());
	const size = data.u32();
	const flags = data.i32();
	auditRequest("read", responseId, { ino, fh, offset, size, flags });

	try {
		const readData = await fs.read(ino, fh, offset, size, flags);
		respond.data(ws, responseId, readData);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function write(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const offset = Number(data.i64());
	const writeData = data.buffer();
	const writeFlags = data.u32();
	const flags = data.i32();
	auditRequest("write", responseId, { ino, fh, offset, writeData, writeFlags, flags});

	try {
		const bytesWritten = await fs.write(ino, fh, offset, writeData, writeFlags, flags);
		respond.write(ws, responseId, bytesWritten);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function release(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const flags = data.i32();
	auditRequest("release", responseId, { ino, fh, flags });

	try {
		await fs.release(ino, fh, flags);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function opendir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const flags = data.i32();
	auditRequest("opendir", responseId, { ino, flags });

	try {
		const openData = await fs.opendir(ino, flags);
		respond.open(ws, responseId, openData);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function readdir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const offset = Number(data.i64());
	auditRequest("readdir", responseId, { ino, fh, offset });

	try {
		const openData = await fs.readdir(ino, fh);
		respond.readdir(ws, responseId, openData.slice(offset));
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function releasedir(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const fh = Number(data.u64());
	const flags = data.i32();
	auditRequest("releasedir", responseId, { ino, fh, flags });

	try {
		await fs.releasedir(ino, fh, flags);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function statfs(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	auditRequest("statfs", responseId, null);

	try {
		const stats = await fs.statfs();
		respond.statfs(ws, responseId, stats);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function setxattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const name = data.string();
	const value = data.buffer();
	const flags = data.i32();
	const position = data.u32();
	auditRequest("setxattr", responseId, { ino, name, value, flags, position });

	try {
		await fs.setxattr(ino, name, value, flags, position);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function getxattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const name = data.string();
	const size = data.u32();
	auditRequest("getxattr", responseId, { ino, name, size });

	try {
		const value = await fs.getxattr(ino, name);
		if (size === 0) {
			respond.xattr(ws, responseId, value.length);
		} else if (value.length <= size) {
			respond.xattr(ws, responseId, value);
		} else {
			respond.error(ws, responseId, constants.replyTypes.xattr, ErrorCode.ERANGE);
		}
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function listxattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const size = data.u32();
	auditRequest("listxattr", responseId, { ino, size });

	try {
		const attributes = await fs.listxattr(ino);

		if (size === 0) {
			let keySize: number;
			if (attributes.length === 0) {
				keySize = 0;
			} else {
				keySize = attributes.reduce((prev, curr) => prev + curr.length, 0) + (attributes.length - 1);
			}
			respond.xattr(ws, responseId, keySize);
		} else {
			const catKeys = attributes.join("\0");
			const catKeysBuf = new TextEncoder().encode(catKeys);

			if (catKeysBuf.length <= size) {
				respond.xattr(ws, responseId, catKeysBuf);
			} else {
				respond.error(ws, responseId, constants.replyTypes.xattr, ErrorCode.ERANGE);
			}
		}
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}

export async function removexattr(fs: IdbFs, ws: WebSocket, data: PacketReader) {
	const responseId = data.u16();
	const ino = Number(data.u64());
	const name = data.string();
	auditRequest("removexattr", responseId, { ino, name });

	try {
		await fs.removexattr(ino, name);
		respond.empty(ws, responseId);
	} catch (err) {
		if (err instanceof FsError && err.code !== null) {
			respond.error(ws, responseId, 0, err.code);
		} else {
			throw err;
		}
	}
}
