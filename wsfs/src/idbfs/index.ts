import { ObjStoreWrapper } from "./idbWrappers";
import { Chunk, Entry, FileType, FsStats, Inode, NodeAttr, ReaddirEntry } from "./types";

/**
 * Opens a filesystem backed by IndexedDB
 * @param name The name to use for the IndexedDB backing the filesystem
 */
function openIdbFs(name: string): Promise<IdbFs> {
	return new Promise((res, rej) => {
		const request = indexedDB.open(name, 1);
		request.onupgradeneeded = () => {
			const db = request.result;

			// File tree (inodes)
			let inodes = new ObjStoreWrapper<Inode>(db.createObjectStore("inodes", {
				autoIncrement: true,
				keyPath: "id",
			}));

			const now = Date.now();

			inodes.add({
				id: 0,
				type: FileType.Special,
				rdev: 0,
				lookups: 0,
				deleted: false,
				generation: -1, // Not representable in u64. Indicates placeholder.
				ctime: now,
				crtime: now,
				mtime: now,
				uid: 1000,
				gid: 1000,
				mode: S_IFREG | 0o755,
				xattrs: new Map(),
			});
			inodes.add({
				id: 1,
				type: FileType.Directory,
				lookups: 0,
				deleted: false,
				generation: gengen(),
				parent: 0, // 0 is reserved to be handled by the kernel
				ctime: now,
				crtime: now,
				mtime: now,
				uid: 1000,
				gid: 1000,
				mode: S_IFDIR | 0o755,
				subdirs: new Map(),
				xattrs: new Map(),
			});

			// Data chunks
			db.createObjectStore("chunks", {
				autoIncrement: true,
				keyPath: "id",
			});
		};
		request.onsuccess = () => {
			res(new IdbFs(request.result));
		};
		request.onerror = () => {
			rej(request.error);
		};
	});
}

const EPERM = 1;
const ENOENT = 2;
const ESRCH = 3;
const EINTR = 4;
const EIO = 5;
const ENXIO = 6;
const E2BIG = 7;
const ENOEXEC = 8;
const EBADF = 9;
const ECHILD = 10;
const EAGAIN = 11;
const ENOMEM = 12;
const EACCES = 13;
const EFAULT = 14;
const ENOTBLK = 15;
const EBUSY = 16;
const EEXIST = 17;
const EXDEV = 18;
const ENODEV = 19;
const ENOTDIR = 20;
const EISDIR = 21;
const EINVAL = 22;
const ENFILE = 23;
const EMFILE = 24;
const ENOTTY = 25;
const ETXTBSY = 26;
const EFBIG = 27;
const ENOSPC = 28;
const ESPIPE = 29;
const EROFS = 30;
const EMLINK = 31;
const EPIPE = 32;
const EDOM = 33;
const ERANGE = 34;
const EWOULDBLOCK = EAGAIN;
const ENOTEMPTY = 66;
const ENODATA = 96;

const errorMap: Record<string, number> = {
	"No such file or directory": ENOENT,
	"Bad file descriptor": EBADF,
	"File or directory already exists": EEXIST,
	"Not a symlink": EBADF,
	"Cannot unlink directory": EISDIR,
	"Cannot delete non-empty directory": ENOTEMPTY,
	"Missing chunk. Inode consistency issue": EIO,
	"File already exists": EEXIST,
	"Can only open files": EIO, // TODO
	"Can only hard-link regular files": EIO, // TODO
	"No such attribute": ENODATA,
};

/**
 * Filesystem error to be returned via FUSE.
 * TODO: Extend with more specific options rather than normal error constructor.
 */
export class FsError extends Error {
	code: number | null;

	constructor(message: string) {
		super(message);
		this.code = errorMap[message] || null;
	}
}

/** The size of each chunk */
const defaultBlockSize = 512;

/** bitmask for file type inside mode */
export const S_IFMT = 0o170000;
export const S_IFDIR = 0o040000;
export const S_IFCHR = 0o020000;
export const S_IFBLK = 0o060000;
export const S_IFREG = 0o100000;
export const S_IFIFO = 0o010000;
export const S_IFLNK = 0o120000;
export const S_IFSOCK = 0o140000;

/** Generates a random `generation` number */
function gengen(): number {
	return Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * An interface to a filesystem backed by IndexedDB.
 */
class IdbFs {
	db: IDBDatabase;
	blockSize: number;
	dirCache: Map<number, ReaddirEntry[]>;

	constructor(database: IDBDatabase) {
		this.db = database;
		this.blockSize = defaultBlockSize; // May be configurable later. We'll see...
		this.dirCache = new Map();
	}

	async lookup(parent: number, name: string): Promise<Entry> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}

		const childInodeNum = parentInode.subdirs.get(name);
		if (typeof childInodeNum !== "number") {
			throw new FsError("No such file or directory");
		}
		const childInode = await inodeStore.get(childInodeNum);
		if (childInode === undefined) {
			throw new FsError("No such file or directory");
		}
		childInode.lookups += 1;
		await inodeStore.put(childInode);

		return {
			attr: await this.getattr(childInodeNum),
			generation: childInode.generation,
		};
	}

	async forget(inodeNum: number, nlookup: number) {
		// Decrement lookup count by nlookup and delete inode if it is staged for deletion
		const transaction = this.db.transaction(["inodes", "chunks"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const inode = await inodeStore.get(inodeNum);
		if (inode === undefined) return;
		inode.lookups -= nlookup;

		// Delete data if unreferenced
		if (inode.deleted) {
			await inodeStore.delete(inodeNum);
			if (inode.type === FileType.File) {
				inode.hardLinks -= 1;
				if (inode.hardLinks === 0) {
					for (const chunk of inode.chunks) {
						await chunkStore.delete(chunk);
					}
				}
			}
		}
	}

	async getattr(inodeNum: number): Promise<NodeAttr> {
		const transaction = this.db.transaction(["inodes"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(inodeNum);
		if (inode === undefined) {
			// Inode? File descriptor? I think I'm gonna return EBADF here....
			throw new FsError("Bad file descriptor");
		}

		let size: number;
		let blocks: number;
		let mtimeMs: number;
		let nlink: number;
		let rdev: number;
		let blksize: number;

		if (inode.type === FileType.File) {
			size = inode.chunks.length * inode.chunksize - inode.trim;
			blocks = inode.chunks.length;
			mtimeMs = inode.mtime;
			nlink = inode.hardLinks;
			rdev = 0;
			blksize = inode.chunksize;
		} else {
			if (inode.type === FileType.Special) {
				rdev = inode.rdev;
			} else {
				rdev = 0;
			}
			size = 0;
			blocks = 0;
			mtimeMs = inode.ctime;
			nlink = 1;
			blksize = this.blockSize;
		}

		return {
			ino: inode.id,
			size,
			blocks,
			atimeSecs: 0,
			mtimeSecs: mtimeMs,
			ctimeSecs: inode.ctime,
			crtimeSecs: inode.crtime,
			mode: inode.mode,
			nlink,
			uid: inode.uid,
			gid: inode.gid,
			rdev,
			blksize,
		};
	}

	/** Sets a file's length. Locks chunk database. Do not call if you've already locked chunk database!!! */
	private async truncate(inode: Inode, size: number, transaction: IDBTransaction): Promise<void> {
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		if (inode.type !== FileType.File) {
			// Maybe throw an error here? Not really sure...
			return;
		}
		const expectedChunks = Math.floor(size / inode.chunksize);

		inode.trim = inode.chunksize - (size % inode.chunksize)
		if (inode.trim === inode.chunksize) inode.trim = 0;

		if (inode.chunks.length < expectedChunks) {
			while (inode.chunks.length < expectedChunks) {
				inode.chunks.push(-1);
			}
		} else if (inode.chunks.length > expectedChunks) {
			while (inode.chunks.length > expectedChunks) {
				await chunkStore.delete(inode.chunks.pop()!);
			}
			if (inode.chunks.length > 0 && inode.trim > 0) {
				const chunk = await chunkStore.get(inode.chunks[inode.chunks.length - 1]);
				if (chunk !== undefined) {
					chunk.data.set(new Array(inode.trim).fill(0), chunk.data.length - inode.trim);
					await chunkStore.put(chunk);
				}
			}
		}
	}

	async setattr(
		ino: number,
		mode: number | null,
		uid: number | null,
		gid: number | null,
		size: number | null,
		mtimeMs: number | null,
		ctimeMs: number | null,
		crtimeMs: number | null,
	): Promise<NodeAttr> {
		const transaction = this.db.transaction(["inodes", "chunks"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("Bad file descriptor");
		}

		if (mode !== null) inode.mode = mode;
		if (uid !== null) inode.uid = uid;
		if (gid !== null) inode.gid = gid;
		if (size !== null && inode.type === FileType.File) await this.truncate(inode, size, transaction);
		if (mtimeMs !== null) inode.mtime = mtimeMs;
		if (ctimeMs !== null) inode.ctime = ctimeMs;
		if (crtimeMs !== null) inode.crtime = crtimeMs;

		await inodeStore.put(inode);

		return await this.getattr(ino);
	}

	async readlink(ino: number): Promise<string> {
		const transaction = this.db.transaction(["inodes"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) throw new FsError("No such file or directory");
		if (inode.type !== FileType.Symlink) throw new FsError("Not a symlink");
		return inode.target;
	}

	/** Create a new file */
	async mknod(
		uid: number,
		gid: number,
		parent: number,
		name: string,
		mode: number,
		umask: number,
		rdev: number,
	): Promise<Entry> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}
		if (parentInode.subdirs.has(name)) {
			throw new FsError("File or directory already exists");
		}

		const now = Date.now();

		let inode: Inode;
		switch (mode & S_IFMT) {
			case S_IFDIR:
				inode = {
					type: FileType.Directory,
					parent,
					lookups: 0,
					deleted: false,
					generation: gengen(),
					crtime: now,
					ctime: now,
					mtime: now,
					mode: mode & (~umask),
					gid,
					uid,
					subdirs: new Map(),
					xattrs: new Map(),
				};
				break;
			case S_IFLNK:
				throw new FsError("Can't create link from mknod");
			case S_IFREG:
				inode = {
					type: FileType.File,
					lookups: 0,
					openHandles: 0,
					hardLinks: 1,
					deleted: false,
					generation: gengen(),
					crtime: now,
					ctime: now,
					mtime: now,
					mode: mode & (~umask),
					gid,
					uid,
					chunks: [],
					chunksize: this.blockSize,
					trim: 0,
					xattrs: new Map(),
				};
				break;
			case S_IFBLK:
			case S_IFCHR:
			case S_IFIFO:
			case S_IFSOCK:
			default:
				inode = {
					type: FileType.Special,
					lookups: 0,
					deleted: false,
					generation: gengen(),
					crtime: now,
					ctime: now,
					mtime: now,
					mode: mode & (~umask),
					gid,
					uid,
					rdev,
					xattrs: new Map(),
				};
				break;
		}

		const inodeId = await inodeStore.add(inode);
		inode.id = inodeId;
		parentInode.subdirs.set(name, inodeId);
		parentInode.mtime = Date.now();
		await inodeStore.put(parentInode);
		return {
			attr: await this.getattr(inodeId),
			generation: inode.generation,
		}
	}

	/** Create a new directory */
	mkdir(uid: number, gid: number, parent: number, name: string, mode: number): Promise<Entry> {
		return this.mknod(uid, gid, parent, name, (mode & (~S_IFMT)) | S_IFDIR, 0, 0);
	}

	/** Unlinks an inode from the filesystem */
	private async unlinkAny(parent: number, name: string, rmdir: boolean) {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}

		const inodeNum = parentInode.subdirs.get(name);
		if (typeof inodeNum !== "number") {
			throw new FsError("No such file or directory");
		}

		const inode = await inodeStore.get(inodeNum);
		if (inode !== undefined) {
			if (inode.type === FileType.Directory) {
				if (!rmdir) {
					throw new FsError("Cannot unlink directory");
				}
				if (inode.subdirs.size) {
					throw new FsError("Cannot delete non-empty directory");
				}
			} else {
				if (rmdir) {
					throw new FsError("Not a directory");
				}
			}
			inode.deleted = true;
			await inodeStore.put(inode);
			this.forget(inodeNum, 0);
		}

		parentInode.subdirs.delete(name);
		await inodeStore.put(parentInode);
	}

	/** Unlinks a file */
	unlink(parent: number, name: string) {
		return this.unlinkAny(parent, name, false);
	}

	/** Unlinks a directory (must be empty) */
	rmdir(parent: number, name: string) {
		return this.unlinkAny(parent, name, true);
	}

	async symlink(uid: number, gid: number, parent: number, linkName: string, target: string): Promise<Entry> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode === undefined || parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}
		if (parentInode.subdirs.has(linkName)) {
			throw new FsError("File already exists");
		}

		const now = Date.now();

		const symlinkInode = {
			type: FileType.Symlink,
			parent,
			lookups: 0,
			deleted: false,
			generation: gengen(),
			crtime: now,
			ctime: now,
			mtime: now,
			mode: S_IFLNK | 0o777,
			gid,
			uid,
			xattrs: new Map(),
			target,
		} as const;
		const symlinkIno = await inodeStore.add(symlinkInode);

		parentInode.subdirs.set(linkName, symlinkIno);
		parentInode.mtime = Date.now();
		await inodeStore.put(parentInode);

		return {
			attr: await this.getattr(symlinkIno),
			generation: symlinkInode.generation,
		}
	}

	async rename(parent: number, name: string, newparent: number, newname: string, _flags: number): Promise<void> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode === undefined || parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}
		const ino = parentInode.subdirs.get(name);
		if (ino === undefined) {
			throw new FsError("No such file or directory");
		}
		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}

		let newparentInode: (Inode & { id: number }) | undefined;
		if (newparent === parent) {
			newparentInode = parentInode;
		} else {
			newparentInode = await inodeStore.get(newparent);
		}
		if (newparentInode === undefined || newparentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}

		if (inode.type === FileType.Directory) {
			inode.parent = newparent;
			await inodeStore.put(inode);
		}
		const time = Date.now();
		parentInode.subdirs.delete(name);
		parentInode.mtime = time;
		newparentInode.subdirs.set(newname, ino);
		newparentInode.mtime = time;
		await inodeStore.put(parentInode);
		if (newparent !== parent) {
			await inodeStore.put(newparentInode);
		}
	}

	async link(ino: number, newparent: number, newname: string): Promise<Entry> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only hard-link regular files");
		}
		const newparentInode = await inodeStore.get(newparent);
		if (newparentInode === undefined || newparentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}
		if (newparentInode.subdirs.has(newname)) {
			throw new FsError("File already exists");
		}

		newparentInode.subdirs.set(newname, ino);

		return {
			attr: await this.getattr(ino),
			generation: inode.generation,
		}
	}

	async open(ino: number, _flags: number): Promise<{ fh: number, flags: number }> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only open files");
		}
		inode.openHandles += 1;
		await inodeStore.put(inode);

		return {
			fh: ino,
			flags: 0,
		};
	}

	async read(
		ino: number,
		_fh: number,
		offset: number,
		size: number,
		_flags: number,
	): Promise<Uint8Array> {
		const transaction = this.db.transaction(["inodes", "chunks"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only open files");
		}

		const availableSize = inode.chunks.length * inode.chunksize - inode.trim - offset;
		size = Math.min(availableSize, size);

		const fileLength = inode.chunks.length * inode.chunksize - inode.trim;
		const destBuf = new Uint8Array(size);
		let cursor = 0;
		while (cursor < size) {
			let fileOffset = cursor + offset;
			let chunkIdx = Math.floor(fileOffset / inode.chunksize);
			let chunkId = inode.chunks[chunkIdx];
			let chunkOffset = (cursor + offset) % inode.chunksize;

			let chunk: Uint8Array;
			if (chunkId === -1) {
				chunk = new Uint8Array(inode.chunksize);
			} else if (chunkId === undefined) {
				break;
			} else {
				let thisChunk = await chunkStore.get(chunkId);
				if (thisChunk === undefined) throw new Error("Filesystem inconsistency error.");
				chunk = thisChunk.data;
			}
			let writeLength = Math.min(chunk.length, fileLength - cursor);
			destBuf.set(chunk.slice(0, writeLength), cursor);
			cursor += inode.chunksize - chunkOffset;
		}

		return destBuf.slice(0, Math.max(0, fileLength - offset));
	}

	async write(
		ino: number,
		_fh: number,
		offset: number,
		data: Uint8Array,
		_write_flags: number,
		_flags: number,
	): Promise<number> {
		const transaction = this.db.transaction(["inodes", "chunks"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only open files");
		}

		let cursor = 0;
		while (cursor < data.length) {
			let fileOffset = cursor + offset;
			let nextChunkIdx = Math.floor(fileOffset / inode.chunksize);
			let nextChunkId = inode.chunks[nextChunkIdx];
			let nextChunkOffset = fileOffset % inode.chunksize;
			let nextChunkData = data.slice(cursor, Math.min(cursor + inode.chunksize - nextChunkOffset, data.length));

			if (nextChunkId === undefined) {
				// Create new chunk
				const newData = new Uint8Array(inode.chunksize);
				newData.set(nextChunkData, nextChunkOffset);
				const newChunkId = await chunkStore.add({ data: newData });
				inode.chunks[nextChunkIdx] = newChunkId;
			} else {
				let nextChunk = await chunkStore.get(nextChunkId);
				if (nextChunk === undefined) throw new FsError("Inconsistent filesystem")
				// Write to existing chunk
				nextChunk.data.set(nextChunkData, nextChunkOffset);
				await chunkStore.put(nextChunk);
			}
			cursor += nextChunkData.length;
		}

		// Update trim and store
		inode.trim = inode.chunksize - ((offset + data.length) % inode.chunksize);
		await inodeStore.put(inode);

		return data.length;
	}

	async release(ino: number, _fh: number, _flags: number): Promise<void> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only open files");
		}
		inode.openHandles -= 1;
		await inodeStore.put(inode);
	}

	async opendir(ino: number, _flags: number): Promise<{ fh: number, flags: number }> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		} else if (inode.type !== FileType.Directory) {
			throw new FsError("Not a directory");
		}

		let key = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
		while (this.dirCache.has(key)) key = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);

		const subdirListing: ReaddirEntry[] = [];
		subdirListing.push({
			ino: 1,
			name: ".",
			type: S_IFDIR,
		});
		subdirListing.push({
			ino: 1,
			name: "..",
			type: S_IFDIR,
		});
		for (const [subdirName, subdirIno] of inode.subdirs.entries()) {
			const subdirInode = await inodeStore.get(subdirIno);
			if (subdirInode === undefined) continue;
			subdirListing.push({
				ino: subdirIno,
				name: subdirName,
				type: subdirInode.mode & S_IFMT,
			});
		}
		this.dirCache.set(key, subdirListing);

		return {
			fh: key,
			flags: 0,
		};
	}

	async readdir(_ino: number, fh: number): Promise<Array<ReaddirEntry>> {
		const cachedDir = this.dirCache.get(fh);
		if (cachedDir === undefined) {
			throw new FsError("Bad file descriptor");
		}

		return cachedDir;
	}

	async releasedir(_ino: number, fh: number, _flags: number): Promise<void> {
		this.dirCache.delete(fh);
	}

	async statfs(): Promise<FsStats> {
		const stats = await navigator.storage.estimate();
		return {
			blocks: (stats.quota || 0) / this.blockSize,
			bfree: (stats.quota || 0) - (stats.usage || 0),
			bavail: (stats.quota || 0) - (stats.usage || 0),
			files: 0, // TODO
			ffree: 0, // TODO
			bsize: this.blockSize,
			namelen: 255,
			frsize: 0
		};
	}

	async setxattr(
		ino: number,
		name: string,
		value: Uint8Array,
		_flags: number,
		_position: number,
	): Promise<void> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}

		inode.xattrs.set(name, value);

		await inodeStore.put(inode);
	}

	async getxattr(
		ino: number,
		name: string,
	): Promise<Uint8Array> {
		const transaction = this.db.transaction(["inodes"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}

		const result = inode.xattrs.get(name);
		if (result === undefined) {
			throw new FsError("No such attribute");
		}

		return result;
	}

	async listxattr(ino: number): Promise<string[]> {
		const transaction = this.db.transaction(["inodes"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}

		return Array.from(inode.xattrs.keys());
	}

	async removexattr(ino: number, name: string): Promise<void> {
		const transaction = this.db.transaction(["inodes"], "readonly");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("No such file or directory");
		}

		inode.xattrs.delete(name);
		await inodeStore.put(inode);
	}
}

export {
	openIdbFs,
	IdbFs,
};

