/**
 * Represents the type of file. These values will eventually get mapped
 * to system-specific ones from libc.
 */
export enum FileType {
	Special     = 0,
	Directory   = 1,
	Symlink     = 2,
	File        = 3,
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
	/**
	 * inode ID / generation number combo must be unique for the duration of the filesystem.
	 */
	generation: number,
	deleted: boolean,

	/** Time (in ms) that the inode's metadata was last modified */
	ctime: number,

	/** Time that the inode was created */
	crtime: number,

	/** Time of last modification */
	mtime: number,

	uid: number,
	gid: number,
	mode: number,

	xattrs: Map<string, Uint8Array>,
}

/** Represents a file of any kind */
export type Inode =
	| SpecialInode
	| FileInode
	| DirInode
	| LinkInode
	;

export type AssignedInode = Inode & { id: number };

/** Special Files */
export interface SpecialInode extends BaseInode {
	type: FileType.Special,
	rdev: number,
}

/** Regular Files */
export interface FileInode extends BaseInode {
	type: FileType.File,
	openHandles: number,
	hardLinks: number,
	/** The size of each chunk in `chunks` */
	chunksize: number,
	/** The number of bytes to trim from the end of the last chunk */
	trim: number,
	/**
	 * `(size, chunkId)`
	 *
	 * Allows calculation of which chunks are needed without fetching linked-list style
	 */
	chunks: Array<number>,
}

/** Directories */
export interface DirInode extends BaseInode {
	type: FileType.Directory,
	parent: number,
	/** filename -> inode */
	subdirs: Map<string, number>,
	mtime: number,
}

/** Symbolic Links */
export interface LinkInode extends BaseInode {
	type: FileType.Symlink,
	parent: number,
	target: string,
}

/**
 * Represents a small part of a file.
 */
export interface Chunk {
	id?: number,
	data: Uint8Array,
}

export interface Entry {
	attr: NodeAttr,
	generation: number,
}

export interface NodeAttr {
    ino: number,
    size: number,
    blocks: number,
    atimeMs: number,
    mtimeMs: number,
    ctimeMs: number,
    crtimeMs: number,
    mode: number,
    nlink: number,
    uid: number,
    gid: number,
    rdev: number,
    blksize: number,
}

export interface FsStats {
	blocks: number,
    bfree: number,
    bavail: number,
    files: number,
    ffree: number,
    bsize: number,
    namelen: number,
    frsize: number
}

export interface ReaddirEntry {
	name: string,
	ino: number,
	type: number,
}
