/**
 * Represents the type of file. These values will eventually get mapped
 * to system-specific ones from libc.
 */
export enum FileType {
	DT_BLK     = 1,
	DT_CHR     = 2,
	DT_DIR     = 3,
	DT_FIFO    = 4,
	DT_LNK     = 5,
	DT_REG     = 6,
	DT_SOCK    = 7,
}

/** Common properties of all inodes */
export interface BaseInode {
	id?: number,
	/**
	 * Inode "lookup count" from FUSE driver.
	 * Whenever an inode number is returned, the lookup count must increase. Whenever the
	 * `forget(inode)` function is called, the count must decrease. When the count reaches
	 * zero, the inode can be deleted.
	 * TODO: Add lookup increments to functions.
	 */
	lookups: number,
	mode: number,
	xattrs: Record<string, Uint8Array>,
}

/** Represents a file of any kind */
export type Inode =
	| FileInode
	| DirInode
	| LinkInode
	| DevInode
	| IpcInode
	;

/** Regular Files */
export interface FileInode extends BaseInode {
	type: FileType.DT_REG,
	aggId: IDBValidKey,
}

/** Directories */
export interface DirInode extends BaseInode {
	type: FileType.DT_DIR,
	parent: number,
	/** filename -> inode */
	subdirs: Map<string, number>,
}

/** Symbolic Links */
export interface LinkInode extends BaseInode {
	type: FileType.DT_LNK,
	parent: number,
	target: string,
}

/** Device files */
export interface DevInode extends BaseInode {
	type: FileType.DT_BLK | FileType.DT_CHR,
	major: number,
	minor: number,
}

/** Special files handled by the kernel. These just need a place in the tree */
export interface IpcInode extends BaseInode {
	type: FileType.DT_FIFO | FileType.DT_SOCK,
}


/**
 * Aggregates chunks outside the inode to allow for easy hard-links.
 */
export interface Aggregation {
	id?: number,
	/**
	 * Counts the number of inodes that reference this data. This value is used to
	 * support hard links. When a file is created, it is initialized to 1. When a
	 * hard link is created, this number is incremented. When an inode is deleted,
	 * this number is decremented. When it reaches 0, it and all chunks it references
	 * should be deleted.
	 */
	linkedInodes: number,
	/**
	 * `(size, chunkId)`
	 *
	 * Allows calculation of which chunks are needed without fetching linked-list style
	 */
	chunks: Array<[number, IDBValidKey]>,
}

/**
 * Represents a small part of a file.
 */
export interface Chunk {
	id?: number,
	data: Uint8Array,
}
