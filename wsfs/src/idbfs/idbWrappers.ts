type Defined<T> = T extends null | undefined ? never : T;

/** Like a promise, but doesn't defer the executor. */
export class PseudoPromise<D, E = any> {
	valueAcquired: boolean;
	errorAcquired: boolean;
	value: D | null;
	error: E | null;
	onSuccess: (data: D) => void;
	onError: (data: E) => void;

	constructor(func: (res: (data: D) => void, rej: (err: any) => void) => void) {
		this.valueAcquired = false;
		this.value = null;
		this.errorAcquired = false;
		this.error = null;
		this.onSuccess = (data: D) => {
			this.valueAcquired = true;
			this.value = data;
		};
		this.onError = (error: E) => {
			this.errorAcquired = true;
			this.error = error;
		};

		func(
			(data: D) => this.onSuccess(data),
			(error: E) => this.onError(error),
		);
	}

	then(onSuccess: (data: D) => void, onError: ((data: E) => void) = () => {}) {
		if (this.valueAcquired) {
			let value = this.value!;
			this.value = null;
			onSuccess(value);
		} else if (this.errorAcquired) {
			let error = this.error!;
			this.error = null;
			onError(error);
		} else {
			this.onSuccess = onSuccess;
			this.onError = onError;
		}
	}
}

export class ObjStoreWrapper<T extends { id?: IDBValidKey }> {
	store: IDBObjectStore;

	constructor(store: IDBObjectStore) {
		this.store = store;
	}

	/** Get object from store */
	get(query: Defined<T["id"]> | IDBKeyRange) {
		return new PseudoPromise<T & { id: Defined<T["id"]> } | undefined>((res, rej) => {
			const result = this.store.get(query);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Add object to store */
	add(obj: T) {
		return new PseudoPromise<Defined<T["id"]>>((res, rej) => {
			const result = this.store.add(obj);
			result.onsuccess = () => res(result.result as Defined<T["id"]>);
			result.onerror = () => rej(result.error);
		});
	}

	/** Update/Add an object in the store */
	put(obj: T) {
		return new PseudoPromise<Defined<T["id"]>>((res, rej) => {
			const result = this.store.put(obj);
			result.onsuccess = () => res(result.result as Defined<T["id"]>);
			result.onerror = () => rej(result.error);
		});
	}

	/** Delete object from store */
	delete(key: Defined<T["id"]> | IDBKeyRange) {
		return new PseudoPromise<void>((res, rej) => {
			const result = this.store.delete(key);
			result.onsuccess = () => res();
			result.onerror = () => rej(result.error);
		});
	}
}

export class ChunkStoreWrapper {
	store: IDBObjectStore;

	constructor(store: IDBObjectStore) {
		this.store = store;
	}

	/** Get object from store */
	get(query: number) {
		return new PseudoPromise<Uint8Array | undefined>((res, rej) => {
			const result = this.store.get(query);
			result.onsuccess = () => res(result.result);
			result.onerror = () => rej(result.error);
		});
	}

	/** Add object to store */
	add(obj: Uint8Array) {
		return new PseudoPromise<number>((res, rej) => {
			const result = this.store.add(obj);
			result.onsuccess = () => res(result.result as number);
			result.onerror = () => rej(result.error);
		});
	}

	/** Update/Add an object in the store */
	put(key: number, obj: Uint8Array) {
		return new PseudoPromise<number>((res, rej) => {
			const result = this.store.put(obj, key);
			result.onsuccess = () => res(result.result as number);
			result.onerror = () => rej(result.error);
		});
	}

	/** Delete object from store */
	delete(key: number) {
		return new PseudoPromise<void>((res, rej) => {
			const result = this.store.delete(key);
			result.onsuccess = () => res();
			result.onerror = () => rej(result.error);
		});
	}
}
