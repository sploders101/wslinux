type Inode = FileInode | DirInode;
interface BaseInode {
	filePath: string,
	mode: number,
	xattrs: Record<string, Uint8Array>,
}
interface FileInode extends BaseInode {
	aggId: number,
}
interface DirInode extends BaseInode {
	subdirs: string[]
}

interface Aggregation {
	aggId?: number,
	// Reference counter for cleanup on deletion (allows hard-links)
	linkedInodes: usize,
	/** size, chunkId allows calculation of which chunks are needed without fetching linked-list style */
	chunks: Array<[number, number]>,
}

interface Chunk {
	chunkId?: number,
	data: Uint8Array,
}
