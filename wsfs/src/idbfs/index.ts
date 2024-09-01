import { Aggregation, Chunk, FileInode, Inode } from "./types";

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
			db.createObjectStore("inodes", {
				autoIncrement: false,
				keyPath: "filePath",
			});
			// Data aggregation instructions
			db.createObjectStore("aggs", {
				autoIncrement: true,
				keyPath: "aggId",
			});
			// Data chunks
			db.createObjectStore("chunks", {
				autoIncrement: true,
				keyPath: "chunkId",
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

class ObjStoreWrapper<T> {
	store: IDBObjectStore;

	constructor(store: IDBObjectStore) {
		this.store = store;
	}

	/** Get object from store */
	get(query: IDBValidKey | IDBKeyRange) {
		return new Promise<T>((res, rej) => {
			const result = this.store.get(query);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Add object to store */
	add(obj: T) {
		return new Promise<IDBValidKey>((res, rej) => {
			const result = this.store.add(obj);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Update/Add an object in the store */
	put(obj: T) {
		return new Promise<IDBValidKey>((res, rej) => {
			const result = this.store.put(obj);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Delete object from store */
	delete(key: IDBValidKey | IDBKeyRange) {
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
 * An interface to a filesystem backed by IndexedDB. For use in the wslinux project.
 */
class IdbFs {
	db: IDBDatabase;
	umask: number;

	/**
	 * @param database The database to back the filesystem
	 */
	constructor(database: IDBDatabase) {
		this.db = database;
		this.umask = 0o0022;
	}

	/** Writes a blob into a file in the filesystem */
	async writeFileAll(path: string, contents: Uint8Array) {
		const transaction = this.db.transaction(["inodes", "aggs", "chunks"], "readwrite");
		const inodes = new ObjStoreWrapper<Inode>(transaction.objectStore("inodes"));
		const aggs = new ObjStoreWrapper<Aggregation>(transaction.objectStore("aggs"));
		const chunks = new ObjStoreWrapper<Chunk>(transaction.objectStore("chunks"));

		// TODO: Traverse directories and verify that parents exist

		let existingInode: Inode | undefined = await inodes.get(path);
		console.log(existingInode);

		const chunk: Chunk = {
			data: contents,
		};
		const chunkId = await chunks.add(chunk);

		if (typeof existingInode == "undefined") {
			// Create new chunk, agg, and inode

			const agg: Aggregation = {
				linkedInodes: 1,
				chunks: [[contents.byteLength, chunkId]],
			};
			const aggId = await aggs.add(agg);

			const inode: FileInode = {
				aggId,
				filePath: path,
				mode: defaultPermissions & (~this.umask),
				xattrs: {},
			};
			const inodeId = await inodes.add(inode);
		} else {
			// Delete all chunks, replace with new chunk

			if (!("aggId" in existingInode)) {
				throw new FsError("Tried to write to a directory")
			}

			const agg: Aggregation = await aggs.get(existingInode.aggId);

			// Delete all existing chunks
			await Promise.all(
				agg.chunks
					.map(([_size, chunk]) => chunks.get(chunk)),
			);

			// Replace chunk map
			agg.chunks = [[contents.byteLength, chunkId]];

			// Update agg
			await aggs.put(agg);
		}
	}
}

export {
	openIdbFs,
	IdbFs,
};

