use crate::binary_packets::{PacketReader, PacketWriter};
use crate::constants;
use fuser::{
    FileAttr, FileType, Filesystem, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory, ReplyEmpty,
    ReplyEntry, ReplyOpen, ReplyStatfs, ReplyWrite, ReplyXattr, TimeOrNow,
};
use std::time::{Duration, SystemTime};

fn make_timestamp(time: TimeOrNow) -> u64 {
    match time {
        TimeOrNow::SpecificTime(time) => as_timestamp(time),
        TimeOrNow::Now => as_timestamp(SystemTime::now()),
    }
}

fn as_timestamp(time: SystemTime) -> u64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn from_timestamp(timestamp: u64) -> SystemTime {
    return SystemTime::UNIX_EPOCH + Duration::from_secs(timestamp);
}

pub trait FsComms {
    fn send_packet(&mut self, packet: Vec<u8>);
    fn add_callback(&mut self, response_id: u16, callback: FsCallback);
    fn get_available_rid(&self) -> u16;
}

fn type_from_mode(mode: libc::mode_t) -> Option<FileType> {
    return match mode & libc::S_IFMT {
        libc::S_IFREG => Some(FileType::RegularFile),
        libc::S_IFBLK => Some(FileType::BlockDevice),
        libc::S_IFCHR => Some(FileType::CharDevice),
        libc::S_IFDIR => Some(FileType::Directory),
        libc::S_IFIFO => Some(FileType::NamedPipe),
        libc::S_IFLNK => Some(FileType::Symlink),
        libc::S_IFSOCK => Some(FileType::Socket),
        _ => None,
    };
}

fn decode_attr(packet: &mut PacketReader) -> Option<FileAttr> {
    let ino = packet.read_u64()?;
    let size = packet.read_u64()?;
    let blocks = packet.read_u64()?;
    let atime = from_timestamp(packet.read_u64()?);
    let mtime = from_timestamp(packet.read_u64()?);
    let ctime = from_timestamp(packet.read_u64()?);
    let crtime = from_timestamp(packet.read_u64()?);
    let mode = packet.read_u32()?;
    let nlink = packet.read_u32()?;
    let uid = packet.read_u32()?;
    let gid = packet.read_u32()?;
    let rdev = packet.read_u32()?;
    let blksize = packet.read_u32()?;

    let kind = type_from_mode(mode).expect("Missing kind from mode");
    let perm = (mode & !libc::S_IFMT) as u16;

    return Some(FileAttr {
        ino,
        size,
        blocks,
        atime,
        mtime,
        ctime,
        crtime,
        kind,
        perm,
        flags: 0,
        nlink,
        uid,
        gid,
        rdev,
        blksize,
    });
}

pub enum FsCallback {
    ReplyCreate(ReplyCreate),
    ReplyEntry(ReplyEntry),
    ReplyAttr(ReplyAttr),
    ReplyData(ReplyData),
    ReplyEmpty(ReplyEmpty),
    ReplyOpen(ReplyOpen),
    ReplyWrite(ReplyWrite),
    ReplyDirectory(ReplyDirectory),
    ReplyStatfs(ReplyStatfs),
    ReplyXattr(ReplyXattr),
}
impl FsCallback {
    /// Handle response from the remote
    pub fn respond(self, mut packet: PacketReader) -> Option<()> {
        let error_code = packet.read_i32()?;
        match self {
            Self::ReplyCreate(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let attr = decode_attr(&mut packet)?;
                    let generation = packet.read_u64()?;
                    let fh = packet.read_u64()?;
                    let flags = packet.read_u32()?;
                    reply.created(&Duration::from_secs(0), &attr, generation, fh, flags);
                }
            }
            Self::ReplyEmpty(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    reply.ok();
                }
            }
            Self::ReplyEntry(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let generation = packet.read_u64()?;
                    let attr = decode_attr(&mut packet)?;
                    reply.entry(&Duration::from_secs(0), &attr, generation);
                }
            }
            Self::ReplyAttr(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let attr = decode_attr(&mut packet)?;
                    reply.attr(&Duration::from_secs(0), &attr);
                }
            }
            Self::ReplyData(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let buf = packet.read_bytes()?;
                    reply.data(&buf);
                }
            }
            Self::ReplyOpen(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let fh = packet.read_u64()?;
                    let flags = packet.read_u32()?;
                    reply.opened(fh, flags);
                }
            }
            Self::ReplyWrite(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let bytes_written = packet.read_u32()?;
                    reply.written(bytes_written);
                }
            }
            Self::ReplyDirectory(mut reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let response_length = packet.read_u16()?;

                    for i in 0..response_length {
                        let ino = packet.read_u64()?;
                        let file_type = type_from_mode(packet.read_u32()?)
                            .expect("Cannot get mode while listing directory");
                        let name = packet.read_str()?.ok()?;
                        if reply.add(ino, (i as i64) + 1, file_type, name) {
                            break;
                        }
                    }

                    reply.ok();
                }
            }
            Self::ReplyStatfs(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let blocks = packet.read_u64()?;
                    let bfree = packet.read_u64()?;
                    let bavail = packet.read_u64()?;
                    let files = packet.read_u64()?;
                    let ffree = packet.read_u64()?;
                    let bsize = packet.read_u32()?;
                    let namelen = packet.read_u32()?;
                    let frsize = packet.read_u32()?;
                    reply.statfs(blocks, bfree, bavail, files, ffree, bsize, namelen, frsize);
                }
            }
            Self::ReplyXattr(reply) => {
                if error_code != 0 {
                    reply.error(error_code);
                } else {
                    let response_type = packet.read_u8()?;
                    match response_type {
                        constants::xattrResponses::SIZE => {
                            let size = packet.read_u32()?;
                            reply.size(size);
                        }
                        constants::xattrResponses::DATA => {
                            let data = packet.read_bytes()?;
                            reply.data(data);
                        }
                        _ => unimplemented!(),
                    }
                }
            }
        }

        return Some(());
    }
}

/// WebSocket FileSystem
///
/// This is the FUSE driver for WSFS, the WebSocket FileSystem. This filesystem
/// is implemented entirely using Web technologies such as IndexedDB and WebSockets
/// so it can run in your browser. This component is the "glue" that bridges FUSE
/// requests and the websocket.
pub struct Wsfs<T: FsComms> {
    comms: T,
}

impl<T: FsComms> Wsfs<T> {
    pub fn new(inner: T) -> Self {
        return Wsfs { comms: inner };
    }
}

impl<T: FsComms> Filesystem for Wsfs<T> {
    fn lookup(
        &mut self,
        _req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        reply: fuser::ReplyEntry,
    ) {
        let mut packet = PacketWriter::new();
        let response_id = self.comms.get_available_rid();

        packet.write_u8(constants::actions::LOOKUP);
        packet.write_u16(response_id);
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEntry(reply));
        self.comms.send_packet(packet.finish());
    }

    fn forget(&mut self, _req: &fuser::Request<'_>, ino: u64, nlookup: u64) {
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::FORGET);
        packet.write_u64(ino);
        packet.write_u64(nlookup);

        self.comms.send_packet(packet.finish());
    }

    fn getattr(&mut self, _req: &fuser::Request<'_>, ino: u64, reply: fuser::ReplyAttr) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::GETATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);

        self.comms
            .add_callback(response_id, FsCallback::ReplyAttr(reply));
        self.comms.send_packet(packet.finish());
    }

    fn setattr(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        mode: Option<u32>,
        uid: Option<u32>,
        gid: Option<u32>,
        size: Option<u64>,
        _atime: Option<fuser::TimeOrNow>,
        mtime: Option<fuser::TimeOrNow>,
        ctime: Option<std::time::SystemTime>,
        _fh: Option<u64>,
        crtime: Option<std::time::SystemTime>,
        _chgtime: Option<std::time::SystemTime>,
        _bkuptime: Option<std::time::SystemTime>,
        _flags: Option<u32>,
        reply: ReplyAttr,
    ) {
        use constants::setattr_types::*;

        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::SETATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);

        if let Some(mode) = mode {
            packet.write_u8(MODE);
            packet.write_u32(mode);
        }
        if let Some(uid) = uid {
            packet.write_u8(UID);
            packet.write_u32(uid);
        }
        if let Some(gid) = gid {
            packet.write_u8(GID);
            packet.write_u32(gid);
        }
        if let Some(size) = size {
            packet.write_u8(SIZE);
            packet.write_u64(size);
        }
        if let Some(mtime) = mtime {
            packet.write_u8(MTIME);
            packet.write_u64(make_timestamp(mtime));
        }
        if let Some(ctime) = ctime {
            packet.write_u8(CTIME);
            packet.write_u64(as_timestamp(ctime));
        }
        if let Some(crtime) = crtime {
            packet.write_u8(CRTIME);
            packet.write_u64(as_timestamp(crtime));
        }
        packet.write_u8(0); // Terminate series

        self.comms
            .add_callback(response_id, FsCallback::ReplyAttr(reply));
        self.comms.send_packet(packet.finish());
    }

    fn readlink(&mut self, _req: &fuser::Request<'_>, ino: u64, reply: fuser::ReplyData) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::READLINK);
        packet.write_u64(ino);

        self.comms
            .add_callback(response_id, FsCallback::ReplyData(reply));
        self.comms.send_packet(packet.finish());
    }

    fn mknod(
        &mut self,
        req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        mode: u32,
        umask: u32,
        rdev: u32,
        reply: ReplyEntry,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::MKNOD);
        packet.write_u16(response_id);
        packet.write_u32(req.uid());
        packet.write_u32(req.gid());
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();
        packet.write_u32(mode);
        packet.write_u32(umask);
        packet.write_u32(rdev);

        self.comms
            .add_callback(response_id, FsCallback::ReplyEntry(reply));
        self.comms.send_packet(packet.finish());
    }

    fn mkdir(
        &mut self,
        req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        mode: u32,
        umask: u32,
        reply: ReplyEntry,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::MKDIR);
        packet.write_u16(response_id);
        packet.write_u32(req.uid());
        packet.write_u32(req.gid());
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();
        packet.write_u32(mode & (!umask));

        self.comms
            .add_callback(response_id, FsCallback::ReplyEntry(reply));
        self.comms.send_packet(packet.finish());
    }

    fn unlink(
        &mut self,
        _req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        reply: fuser::ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::UNLINK);
        packet.write_u16(response_id);
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn rmdir(
        &mut self,
        _req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::RMDIR);
        packet.write_u16(response_id);
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn symlink(
        &mut self,
        req: &fuser::Request<'_>,
        parent: u64,
        link_name: &std::ffi::OsStr,
        target: &std::path::Path,
        reply: ReplyEntry,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::SYMLINK);
        packet.write_u16(response_id);
        packet.write_u32(req.uid());
        packet.write_u32(req.gid());
        packet.write_u64(parent);
        packet.write_str(link_name.to_str().unwrap()).unwrap();
        packet.write_str(target.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEntry(reply));
        self.comms.send_packet(packet.finish());
    }

    fn rename(
        &mut self,
        _req: &fuser::Request<'_>,
        parent: u64,
        name: &std::ffi::OsStr,
        newparent: u64,
        newname: &std::ffi::OsStr,
        flags: u32,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::RENAME);
        packet.write_u16(response_id);
        packet.write_u64(parent);
        packet.write_str(name.to_str().unwrap()).unwrap();
        packet.write_u64(newparent);
        packet.write_str(newname.to_str().unwrap()).unwrap();
        packet.write_u32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn link(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        newparent: u64,
        newname: &std::ffi::OsStr,
        reply: ReplyEntry,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::LINK);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(newparent);
        packet.write_str(newname.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEntry(reply));
        self.comms.send_packet(packet.finish());
    }

    fn open(&mut self, _req: &fuser::Request<'_>, ino: u64, flags: i32, reply: fuser::ReplyOpen) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::OPEN);
        // const responseId = data.u16();
        packet.write_u16(response_id);
        // const ino = Number(data.u64());
        packet.write_u64(ino);
        // const flags = data.i32();
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyOpen(reply));
        self.comms.send_packet(packet.finish());
    }

    fn read(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        fh: u64,
        offset: i64,
        size: u32,
        flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyData,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::READ);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(fh);
        packet.write_i64(offset);
        packet.write_u32(size);
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyData(reply));
        self.comms.send_packet(packet.finish());
    }

    fn write(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        fh: u64,
        offset: i64,
        data: &[u8],
        write_flags: u32,
        flags: i32,
        _lock_owner: Option<u64>,
        reply: fuser::ReplyWrite,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::WRITE);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(fh);
        packet.write_i64(offset);
        packet.write_bytes(data).unwrap();
        packet.write_u32(write_flags);
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyWrite(reply));
        self.comms.send_packet(packet.finish());
    }

    fn release(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        fh: u64,
        flags: i32,
        _lock_owner: Option<u64>,
        _flush: bool,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::RELEASE);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(fh);
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn opendir(&mut self, _req: &fuser::Request<'_>, ino: u64, flags: i32, reply: ReplyOpen) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::OPENDIR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyOpen(reply));
        self.comms.send_packet(packet.finish());
    }

    fn readdir(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        fh: u64,
        offset: i64,
        reply: fuser::ReplyDirectory,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::READDIR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(fh);
        packet.write_i64(offset);

        self.comms
            .add_callback(response_id, FsCallback::ReplyDirectory(reply));
        self.comms.send_packet(packet.finish());
    }

    fn releasedir(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        fh: u64,
        flags: i32,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::RELEASEDIR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u64(fh);
        packet.write_i32(flags);

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn statfs(&mut self, _req: &fuser::Request<'_>, _ino: u64, reply: fuser::ReplyStatfs) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::STATFS);
        packet.write_u16(response_id);

        self.comms
            .add_callback(response_id, FsCallback::ReplyStatfs(reply));
        self.comms.send_packet(packet.finish());
    }

    fn setxattr(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        name: &std::ffi::OsStr,
        value: &[u8],
        flags: i32,
        position: u32,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::SETXATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_str(name.to_str().unwrap()).unwrap();
        packet.write_bytes(value).unwrap();
        packet.write_i32(flags);
        packet.write_u32(position);

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }

    fn getxattr(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        name: &std::ffi::OsStr,
        size: u32,
        reply: fuser::ReplyXattr,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::GETXATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_str(name.to_str().unwrap()).unwrap();
        packet.write_u32(size);

        self.comms
            .add_callback(response_id, FsCallback::ReplyXattr(reply));
        self.comms.send_packet(packet.finish());
    }

    fn listxattr(&mut self, _req: &fuser::Request<'_>, ino: u64, size: u32, reply: ReplyXattr) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::LISTXATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_u32(size);

        self.comms
            .add_callback(response_id, FsCallback::ReplyXattr(reply));
        self.comms.send_packet(packet.finish());
    }

    fn removexattr(
        &mut self,
        _req: &fuser::Request<'_>,
        ino: u64,
        name: &std::ffi::OsStr,
        reply: ReplyEmpty,
    ) {
        let response_id = self.comms.get_available_rid();
        let mut packet = PacketWriter::new();

        packet.write_u8(constants::actions::REMOVEXATTR);
        packet.write_u16(response_id);
        packet.write_u64(ino);
        packet.write_str(name.to_str().unwrap()).unwrap();

        self.comms
            .add_callback(response_id, FsCallback::ReplyEmpty(reply));
        self.comms.send_packet(packet.finish());
    }
}
