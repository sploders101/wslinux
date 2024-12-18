pub mod actions{
	pub const INTERNALS: u8 = 0;
	pub const INIT: u8 = 1;
	pub const DESTROY: u8 = 2;
	pub const LOOKUP: u8 = 3;
	pub const FORGET: u8 = 4;
	pub const BATCH_FORGET: u8 = 5;
	pub const GETATTR: u8 = 6;
	pub const SETATTR: u8 = 7;
	pub const READLINK: u8 = 8;
	pub const MKNOD: u8 = 9;
	pub const MKDIR: u8 = 10;
	pub const UNLINK: u8 = 11;
	pub const RMDIR: u8 = 12;
	pub const SYMLINK: u8 = 13;
	pub const RENAME: u8 = 14;
	pub const LINK: u8 = 15;
	pub const OPEN: u8 = 16;
	pub const READ: u8 = 17;
	pub const WRITE: u8 = 18;
	pub const FLUSH: u8 = 19;
	pub const RELEASE: u8 = 20;
	pub const FSYNC: u8 = 21;
	pub const OPENDIR: u8 = 22;
	pub const READDIR: u8 = 23;
	pub const READDIRPLUS: u8 = 24;
	pub const RELEASEDIR: u8 = 25;
	pub const FSYNCDIR: u8 = 26;
	pub const STATFS: u8 = 27;
	pub const SETXATTR: u8 = 28;
	pub const GETXATTR: u8 = 29;
	pub const LISTXATTR: u8 = 30;
	pub const REMOVEXATTR: u8 = 31;
	pub const ACCESS: u8 = 32;
	pub const CREATE: u8 = 33;
	pub const GETLK: u8 = 34;
	pub const SETLK: u8 = 35;
	pub const BMAP: u8 = 36;
	pub const IOCTL: u8 = 37;
	pub const POLL: u8 = 38;
	pub const FALLOCATE: u8 = 39;
	pub const LSEEK: u8 = 40;
	pub const COPY_FILE_RANGE: u8 = 41;
	pub const SETVOLNAME: u8 = 42;
	pub const EXCHANGE: u8 = 43;
	pub const GETXTIMES: u8 = 44;
}
pub mod internals {
	pub const VERSION: u8 = 0;
	pub const REPLY: u8 = 1;
}
pub mod replyTypes {
	pub const EMPTY: u8 = 0;
	pub const ENTRY: u8 = 1;
	pub const ATTR: u8 = 2;
	pub const DATA: u8 = 3;
	pub const OPEN: u8 = 4;
	pub const WRITE: u8 = 5;
	pub const READDIR: u8 = 6;
	pub const STATFS: u8 = 7;
	pub const XATTR: u8 = 8;
	pub const CREATE: u8 = 9;
}
pub mod replyStates {
	pub const SUCCESS: i32 = 0;
}
pub mod xattrResponses {
	pub const SIZE: u8 = 0;
	pub const DATA: u8 = 1;
}
pub mod setattr_types {
	pub const MODE: u8 = 1;
	pub const UID: u8 = 2;
	pub const GID: u8 = 3;
	pub const SIZE: u8 = 4;
	pub const MTIME: u8 = 5;
	pub const CTIME: u8 = 6;
	pub const CRTIME: u8 = 7;
}
