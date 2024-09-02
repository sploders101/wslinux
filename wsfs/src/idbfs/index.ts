import { ObjStoreWrapper } from "./idbWrappers";
import { Aggregation, Chunk, FileInode, FileType, Inode } from "./types";

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
			inodes.add({
				id: 0,
				type: FileType.DT_DIR,
				parent: 0, // `/../` is the same as `/`
				mode: 0o755,
				subdirs: new Map(),
				xattrs: {},
			});

			// Data aggregation instructions
			db.createObjectStore("aggs", {
				autoIncrement: true,
				keyPath: "id",
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

const defaultPermissions = 0o0666;

/**
 * An interface to a filesystem backed by IndexedDB.
 */
class IdbFs {
	db: IDBDatabase;
	/** inodes that need to be cleaned up once they are closed */
	unlinkedInodes: number[];

	constructor(database: IDBDatabase) {
		this.db = database;
		this.unlinkedInodes = [];
	}

	/** Create a new directory */
	async mkdir(parent: number, name: string, mode: number): Promise<number> {
		const transaction = this.db.transaction(["inodes"], "readwrite");

		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode.type !== FileType.DT_DIR) {
			throw new FsError("Parent must be a directory");
		}
		if (name in parentInode.subdirs) {
			throw new FsError("Directory already exists");
		}

		const inode: Inode = {
			type: FileType.DT_DIR,
			mode,
			parent,
			subdirs: {},
			xattrs: {},
		};
		const inodeId = await inodeStore.add(inode);

		parentInode.subdirs.set(name, inodeId);
		await inodeStore.add(parentInode);

		transaction.commit();
		return inodeId;
	}

	/** Link tmpfile to filesystem */
	async linkFile(file: number, parent: number, name: string) {
		const transaction = this.db.transaction(["inodes", "aggs", "chunks"], "readwrite");

		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const aggStore = new ObjStoreWrapper<Aggregation>(transaction.objectStore("aggs"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode.type !== FileType.DT_DIR) {
			throw new FsError("No such file or directory");
		}
		let olddir = parentInode.subdirs.get(name);
		parentInode.subdirs.set(name, file);
		await inodeStore.add(parentInode);

		if (typeof olddir === "number") {
			// TODO: Clean up defunct inode
		}
	}

	/** Unlinks a file from the filesystem */
	async unlinkFile(parent: number, name: string) {
		const transaction = this.db.transaction(["inodes", "aggs", "chunks"], "readwrite");

		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const aggStore = new ObjStoreWrapper<Aggregation>(transaction.objectStore("aggs"));
		const chunkStore = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		const parentInode = await inodeStore.get(parent);
		if (parentInode.type !== FileType.DT_DIR) {
			throw new FsError("No such file or directory");
		}
	}

	/** Create a temporary file */
	async createTmpFile(mode: number): Promise<number> {
		const transaction = this.db.transaction(["inodes", "aggs", "chunks"], "readwrite");

		const agg: Aggregation = {
			chunks: [],
			linkedInodes: 1,
		};
		const aggStore = new ObjStoreWrapper<Aggregation>(transaction.objectStore("aggs"));
		const aggId = await aggStore.add(agg);

		const inode: Inode = {
			type: FileType.DT_REG,
			mode,
			xattrs: {},
			aggId,
		};
		const inodeStore = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const inodeId = await inodeStore.add(inode);

		transaction.commit();
		return inodeId;
	}
}

export {
	openIdbFs,
	IdbFs,
};

