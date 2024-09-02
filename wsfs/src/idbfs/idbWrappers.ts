type Defined<T> = T extends null | undefined ? never : T;

export class ObjStoreWrapper<T extends { id?: IDBValidKey }> {
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
