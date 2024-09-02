export class Mutex {
	_locked: boolean;
	_queue: Array<(guard: MutexGuard) => void>;

	constructor() {
		this._locked = false;
		this._queue = [];
	}

	lock() {
		return new Promise<MutexGuard>((res) => {
			if (this._locked) {
				this._queue.push(res);
			} else {
				this._locked = true;
				res(new MutexGuard(this));
			}
		});
	}
}

export class MutexGuard {
	private owningMutex: Mutex;
	private unlocked: boolean;

	constructor(mutex: Mutex) {
		this.owningMutex = mutex;
		this.unlocked = false;
	}

	unlock() {
		if (this.unlocked) return;
		this.unlocked = true;
		const nextInQueue = this.owningMutex._queue.shift();
		if (typeof nextInQueue === "function") {
			nextInQueue(new MutexGuard(this.owningMutex));
		} else {
			this.owningMutex._locked = false;
		}
	}
}
