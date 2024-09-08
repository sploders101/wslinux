import { ObjStoreWrapper } from "./idbWrappers";
import { AssignedInode, Chunk, FileType, FsStats, Inode, NodeStat, ReaddirEntry } from "./types";

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
				uid: 0,
				gid: 0,
				mode: 0o755,
				xattrs: new Map(),
			});
			inodes.add({
				id: 1,
				type: FileType.Directory,
				lookups: 0,
				deleted: false,
				generation: gengen(),
				parent: 1, // `/../` is the same as `/`
				ctime: now,
				crtime: now,
				mtime: now,
				uid: 0,
				gid: 0,
				mode: 0o755,
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

/**
 * Filesystem error to be returned via FUSE.
 * TODO: Extend with more specific options rather than normal error constructor.
 */
export class FsError extends Error { }

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

	async lookup(parent: number, name: string): Promise<NodeStat> {
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

		return await this.getattr(childInodeNum);
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

	async getattr(inodeNum: number): Promise<NodeStat> {
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
			atimeMs: 0,
			mtimeMs,
			ctimeMs: inode.ctime,
			crtimeMs: inode.crtime,
			mode: inode.mode,
			nlink,
			uid: inode.uid,
			gid: inode.gid,
			rdev,
			blksize,
		};
	}

	/** Sets a file's length. Locks chunk database. Do not call if you've already locked chunk database!!! */
	private async truncate(inode: Inode, size: number): Promise<void> {
		const transaction = this.db.transaction(["chunks"], "readwrite");
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
		mtime: number | null,
		ctime: number | null,
		crtime: number | null,
	): Promise<NodeStat> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const inode = await inodeStore.get(ino);
		if (inode === undefined) {
			throw new FsError("Bad file descriptor");
		}

		if (mode !== null) inode.mode = mode;
		if (uid !== null) inode.uid = uid;
		if (gid !== null) inode.gid = gid;
		if (size !== null && inode.type === FileType.File) await this.truncate(inode, size);
		if (mtime !== null) inode.mtime = mtime;
		if (ctime !== null) inode.ctime = ctime;
		if (crtime !== null) inode.crtime = crtime;

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
	): Promise<AssignedInode> {
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
		return inode as AssignedInode;
	}

	/** Create a new directory */
	mkdir(uid: number, gid: number, parent: number, name: string, mode: number): Promise<AssignedInode> {
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

	async symlink(uid: number, gid: number, parent: number, linkName: string, target: string): Promise<NodeStat> {
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

		const symlinkIno = await inodeStore.add({
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
		});

		parentInode.subdirs.set(linkName, symlinkIno);
		parentInode.mtime = Date.now();
		await inodeStore.put(parentInode);

		return await this.getattr(symlinkIno);
	}

	async rename(parent: number, name: string, newparent: number, newname: string): Promise<void> {
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

		const newparentInode = await inodeStore.get(newparent);
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
		await Promise.all([
			inodeStore.put(parentInode),
			inodeStore.put(newparentInode),
		]);
	}

	async link(ino: number, newparent: number, newname: string): Promise<NodeStat> {
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

		return await this.getattr(ino);
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

		const destBuf = new Uint8Array(size);
		let copiedBytes = 0;
		while (copiedBytes < size) {
			const startByte = offset + copiedBytes;
			const startChunkIdx = Math.floor(startByte / inode.chunksize);
			const startSubIdx = startByte % inode.chunksize;
			const endSubIdx = Math.min(size - copiedBytes, inode.chunksize);
			const chunkId = inode.chunks[startChunkIdx];
			let chunk;
			if (chunkId === -1) {
				// Sparse files
				chunk = { id: inode.chunks[startChunkIdx], data: new Uint8Array(inode.chunksize) };
			} else {
				chunk = await chunkStore.get(chunkId);
				if (chunk === undefined) {
					throw new FsError("Missing chunk. Inode inconsistency issue.");
				}
			}
			destBuf.set(chunk.data.slice(startSubIdx, endSubIdx), copiedBytes);
			copiedBytes += endSubIdx - startSubIdx;
		}

		return destBuf;
	}

	async write(
		ino: number,
		_fh: number,
		offset: number,
		data: Uint8Array,
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

		let cursor = offset;
		const endAt = offset + data.length;
		while (cursor < endAt) {
			// Weird math. Probably want to simplify this later, but should work for now
			const thisChunkIdx = Math.floor(cursor / inode.chunksize);
			const subChunkStart = cursor % inode.chunksize;
			const subChunkEnd = Math.min(inode.chunksize, endAt % inode.chunksize);
			const dataStartIdx = cursor - offset;
			const dataEndIdx = dataStartIdx + (subChunkEnd - subChunkStart);

			// Pad with zeros until we reach the desired index
			while (inode.chunks.length < thisChunkIdx) {
				inode.chunks.push(-1);
			}

			// Insert new chunk
			const thisChunkId = inode.chunks[thisChunkIdx];
			if (thisChunkId === undefined || thisChunkId === -1) {
				// Create new chunk and assign
				const newData = new Uint8Array(inode.chunksize);
				newData.set(data.slice(dataStartIdx, dataEndIdx), dataStartIdx);
				const newChunkId = await chunkStore.add({ data: newData });
				inode.chunks[thisChunkIdx] = newChunkId;
			} else {
				// Update existing chunk
				const chunk = await chunkStore.get(thisChunkId);
				if (chunk === undefined) {
					throw new FsError("Missing chunk");
				}
				chunk.data.set(data.slice(dataStartIdx, dataEndIdx), dataStartIdx);
				await chunkStore.put(chunk);
			}

			// Maybe a trim value isn't the best here, but I'm invested at this point
			inode.trim = inode.chunksize - ((offset + data.length) % inode.chunksize);
			if (inode.trim === inode.chunksize) inode.trim = 0;

			// Advance cursor by written amount
			cursor += subChunkEnd - subChunkStart;
		}

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

