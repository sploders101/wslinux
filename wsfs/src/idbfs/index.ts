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

type Defined<T> = T extends null | undefined ? never : T;

class ObjStoreWrapper<T extends { id?: IDBValidKey }> {
	store: IDBObjectStore;

	constructor(store: IDBObjectStore) {
		this.store = store;
	}

	/** Get object from store */
	get(query: Defined<T["id"]> | IDBKeyRange) {
		return new Promise<T>((res, rej) => {
			const result = this.store.get(query);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Add object to store */
	add(obj: T) {
		return new Promise<Defined<T["id"]>>((res, rej) => {
			const result = this.store.add(obj);
			result.onsuccess = () => res(result.result as Defined<T["id"]>);
			result.onerror = () => rej(result.error);
		});
	}

	/** Update/Add an object in the store */
	put(obj: T) {
		return new Promise<Defined<T["id"]>>((res, rej) => {
			const result = this.store.put(obj);
			result.onsuccess = () => res(result.result as Defined<T["id"]>);
			result.onerror = () => rej(result.error);
		});
	}

	/** Delete object from store */
	delete(key: Defined<T["id"]> | IDBKeyRange) {
		return new Promise<void>((res, rej) => {
			const result = this.store.delete(key);
			result.onsuccess = () => res();
			result.onerror = () => rej(result.error);
		});
	}
}


/**
 * Filesystem error to be returned via FUSE.
 * TODO: Extend with more specific options rather than normal error constructor.
 */
class FsError extends Error {}

const defaultPermissions = 0o0666;

/**
 * An interface to a filesystem backed by IndexedDB.
 */
class IdbFs {
	db: IDBDatabase;
	umask: number;
	inodeCache: Map<number, Inode>;

	constructor(database: IDBDatabase) {
		this.db = database;
		this.umask = 0o0022;
		this.inodeCache = new Map();
	}
}

export {
	openIdbFs,
	IdbFs,
};

