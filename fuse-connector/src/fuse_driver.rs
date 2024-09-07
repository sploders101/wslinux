use fuser::Filesystem;

/// WebSocket FileSystem
///
/// This is the FUSE driver for WSFS, the WebSocket FileSystem. This filesystem
/// is implemented entirely using Web technologies such as IndexedDB and WebSockets
/// so it can run in your browser. This component is the "glue" that bridges FUSE
/// requests and the websocket.
struct Wsfs(tokio::sync::mpsc::Sender<(Vec<u8>, tokio::sync::oneshot::Sender<Vec<u8>>)>);

impl Filesystem for Wsfs {
    fn lookup(&mut self, _req: &fuser::Request<'_>, parent: u64, name: &std::ffi::OsStr, reply: fuser::ReplyEntry) {
        
    }
}
