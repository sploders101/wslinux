# IDBFS

This is the IndexedDB Filesystem, a filesystem that aims to be POSIX-compliant enough to reasonably boot a Linux
system. It is being developed as part of WSLinux and will serve as the backing store for a FUSE driver that gets
mounted in the initramfs. See the readme of the main project for more details.


## Design

This filesystem borrows concepts from traditional POSIX-compliant filesystems, using inodes for filesystem metadata and
file data allocated in chunks (though in this case its purpose is to avoid excessive writes to the database rather than
dynamically allocating data on a flat plane). `Aggregation` (or `agg`) structures are used to keep an index for
re-assembling chunks upon request. These are kept in a separate structure and referenced from the inode to assist in
the creation of hard links.
