export type Inode = FileInode | DirInode;
export interface BaseInode {
	filePath: string,
	mode: number,
	xattrs: Record<string, Uint8Array>,
}
export interface FileInode extends BaseInode {
	aggId: IDBValidKey,
}
export interface DirInode extends BaseInode {
	subdirs: string[]
}

export interface Aggregation {
	aggId?: number,
	// Reference counter for cleanup on deletion (allows hard-links)
	linkedInodes: number,
	/** size, chunkId allows calculation of which chunks are needed without fetching linked-list style */
	chunks: Array<[number, IDBValidKey]>,
}

export interface Chunk {
	chunkId?: number,
	data: Uint8Array,
}
