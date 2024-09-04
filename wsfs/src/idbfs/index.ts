import { ObjStoreWrapper } from "./idbWrappers";
import { Chunk, FileType, Inode, NodeStat } from "./types";

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
class FsError extends Error { }

/** The size of each chunk */
const defaultBlockSize = 256;

/** bitmask for file type inside mode */
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFREG = 0o100000;
const S_IFIFO = 0o010000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;

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

	constructor(database: IDBDatabase) {
		this.db = database;
		this.blockSize = defaultBlockSize; // May be configurable later. We'll see...
	}

	async lookup(parent: number, name: string): Promise<NodeStat> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (typeof parentInode === "undefined") {
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
		if (typeof childInode === "undefined") {
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
		if (typeof inode === "undefined") return;
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
		if (typeof inode === "undefined") {
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
		    ino: inode.id!,
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
		if (typeof inode === "undefined") {
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
		if (typeof inode === "undefined") throw new FsError("No such file or directory");
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
	): Promise<Inode> {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (typeof parentInode === "undefined") {
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
		parentInode.subdirs.set(name, inodeId);
		parentInode.mtime = Date.now();
		await inodeStore.put(parentInode);
		return inode;
	}

	/** Create a new directory */
	mkdir(uid: number, gid: number, parent: number, name: string, mode: number): Promise<Inode> {
		return this.mknod(uid, gid, parent, name, (mode & (~S_IFMT)) | S_IFDIR, 0, 0);
	}

	/** Unlinks an inode from the filesystem */
	private async unlinkAny(parent: number, name: string, rmdir: boolean) {
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (typeof parentInode === "undefined") {
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
		if (typeof inode !== "undefined") {
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
		if (typeof parentInode === "undefined" || parentInode.type !== FileType.Directory) {
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
		if (typeof parentInode === "undefined" || parentInode.type !== FileType.Directory) {
			throw new FsError("No such file or directory");
		}
		const ino = parentInode.subdirs.get(name);
		if (typeof ino === "undefined") {
			throw new FsError("No such file or directory");
		}
		const inode = await inodeStore.get(ino);
		if (typeof inode === "undefined") {
			throw new FsError("No such file or directory");
		}

		const newparentInode = await inodeStore.get(newparent);
		if (typeof newparentInode === "undefined" || newparentInode.type !== FileType.Directory) {
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
		if (typeof inode === "undefined") {
			throw new FsError("No such file or directory");
		}
		if (inode.type !== FileType.File) {
			throw new FsError("Can only hard-link regular files");
		}
		const newparentInode = await inodeStore.get(newparent);
		if (typeof newparentInode === "undefined" || newparentInode.type !== FileType.Directory) {
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
		if (typeof inode === "undefined") {
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
		const transaction = this.db.transaction(["inodes"], "readwrite");
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const inode = await inodeStore.get(ino);
		if (typeof inode === "undefined") {
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
			const startByte = size - copiedBytes;
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
				if (typeof chunk === "undefined") {
					throw new FsError("Missing chunk. Inode inconsistency issue.");
				}
			}
			destBuf.set(chunk.data.slice(startSubIdx, endSubIdx), copiedBytes);
			copiedBytes += endSubIdx - startSubIdx;
		}

		return destBuf;
	}
}

export {
	openIdbFs,
	IdbFs,
};
