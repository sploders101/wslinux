/**
 * Opens a filesystem backed by IndexedDB
 * @param name {string} The name to use for the IndexedDB backing the filesystem
 * @returns {Promise<IdbFs>}
 */
function openIdbFs(name) {
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

/**
 * Get object from store
 * @param store {IDBObjectStore}
 * @param query {IDBValidKey | IDBKeyRange}
 * @returns {any}
 */
function idbGet(store, query) {
	return new Promise((res, rej) => {
		const result = store.get(query);
		result.onsuccess = () => res(result.result);
		result.onerror = () => rej(result.error);
	});
}

/**
 * Add object to store
 * @param store {IDBObjectStore}
 * @param obj {any}
 * @returns {any}
 */
function idbAdd(store, obj) {
	return new Promise((res, rej) => {
		const result = store.add(obj);
		result.onsuccess = () => res(result.result);
		result.onerror = () => rej(result.error);
	});
}

/**
 * Update/Add an object in the store
 * @param store {IDBObjectStore}
 * @param obj {any}
 * @returns {any}
 */
function idbPut(store, obj) {
	return new Promise((res, rej) => {
		const result = store.put(obj);
		result.onsuccess = () => res(result.result);
		result.onerror = () => rej(result.error);
	});
}

/**
 * Delete object from store
 * @param store {IDBObjectStore}
 * @param key {IDBValidKey | IDBKeyRange}
 */
function idbDel(store, key) {
	return new Promise((res, rej) => {
		const result = store.delete(key);
		result.onsuccess = () => res();
		result.onerror = () => rej(result.error);
	});
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
	/**
	 * @param database {IDBDatabase} The database to back the filesystem
	 */
	constructor(database) {
		this.db = database;
		this.umask = 0o0022;
	}

	/**
	 * Writes a blob into a file in the filesystem
	 * @param path {string}
	 * @param contents {Uint8Array}
	 */
	async writeFileAll(path, contents) {
		const transaction = this.db.transaction(["inodes", "aggs", "chunks"], "readwrite");
		const inodes = transaction.objectStore("inodes");
		const aggs = transaction.objectStore("aggs");
		const chunks = transaction.objectStore("chunks");

		// TODO: Traverse directories and verify that parents exist

		/** @type {Inode | undefined} */
		let existingInode = await idbGet(inodes, path);
		console.log(existingInode);

		/** @type {Chunk} */
		const chunk = {
			data: contents,
		};
		const chunkId = await idbAdd(chunks, chunk);

		if (typeof existingInode == "undefined") {
			// Create new chunk, agg, and inode

			/** @type {Aggregation} */
			const agg = {
				linkedInodes: 1,
				chunks: [contents.byteLength, chunkId],
			};
			const aggId = await idbAdd(aggs, agg);

			/** @type {FileInode} */
			const inode = {
				aggId,
				filePath: path,
				mode: defaultPermissions & (~this.umask),
				xattrs: {},
			};
			const inodeId = await idbAdd(inodes, inode);
		} else {
			// Delete all chunks, replace with new chunk

			/** @type {Aggregation} */
			const agg = await idbGet(aggs, existingInode.aggId);

			// Delete all existing chunks
			await Promise.all(
				agg.chunks
					.map(([_size, chunk]) => idbDel(chunks, chunk)),
			);

			// Replace chunk map
			agg.chunks = [contents.byteLength, chunkId];

			// Update agg
			await idbPut(aggs, agg);
		}
	}
}
