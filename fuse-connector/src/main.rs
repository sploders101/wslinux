mod binary_packets;
mod constants;
mod fuse_driver;

use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    os::fd::AsRawFd,
    sync::Arc,
};

use binary_packets::PacketReader;
use fuse_driver::{FsCallback, FsComms, Wsfs};
use fuser::{BackgroundSession, MountOption};
use futures_util::{SinkExt, StreamExt};
use nix::unistd::ForkResult;
use qrcode::QrCode;
use tokio::{
    select,
    sync::{
        mpsc::{self, Receiver, Sender},
        oneshot,
    },
};
use warp::{filters::ws::Message, Filter};
use clap::Parser;

#[derive(Parser)]
struct Args {
    mountpoint: String,

    #[arg(short = 'o', long, default_value = "")]
    options: String,
}

fn main() {
    let args = Args::parse();
    let options = parse_options(&args.options).collect::<Vec<_>>();
    let (recv, send) = nix::unistd::pipe().expect("Couldn't create pipe");
    unsafe {
        match nix::unistd::fork().expect("Couldn't fork wsfs-connector") {
            ForkResult::Parent { .. } => {
                nix::unistd::close(send.as_raw_fd()).unwrap();

                let mut file = std::fs::File::from(recv);
                let mut buf = Vec::new();
                let _ = file.read_to_end(&mut buf);
                let mut packet = PacketReader::new(&buf);
                let return_code = packet.read_i32();
                if return_code != Some(0) {
                    panic!("Return code from child was not 0. Something went very wrong.");
                }
            }
            ForkResult::Child => {
                nix::unistd::close(recv.as_raw_fd()).unwrap();
                let file = std::fs::File::from(send);

                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Couldn't build tokio runtime");
                runtime.block_on(tokio_entrypoint(file, args, options));
            }
        }
    }
}

async fn tokio_entrypoint(file: std::fs::File, args: Args, options: Vec<MountOption>) {
    pretty_env_logger::init();
    let file = Arc::new(tokio::sync::Mutex::new(Some(file)));
    let args = Arc::new(args);
    let options = Arc::new(options);

    let ws_route = warp::path("fshost")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .map(move |ws: warp::ws::Ws| {
            // And then our closure will be called when it completes...
            let file = Arc::clone(&file);
            let args = Arc::clone(&args);
            let options = Arc::clone(&options);
            ws.on_upgrade(move |mut websocket| async move {
                println!("Connection established. Mounting filesystem.");
                if let Some(mut file) = file.lock().await.take() {
                    let _ = file.write_all(&0i32.to_ne_bytes());
                }
                let mut message_handler = WsMessageHandler::new(&args.mountpoint, &options);
                loop {
                    select! {
                        chunk = websocket.next() => match chunk {
                            Some(Ok(message)) => {
                                if !message.is_binary() {
                                    return;
                                }
                                let bytes = message.into_bytes();
                                message_handler.process_message(bytes).await;
                            },
                            _ => return,
                        },
                        chunk = message_handler.process_requests() => {
                            // Runs when a fuse requests to send a packet
                            websocket.send(Message::binary(chunk)).await.expect("Couldn't send packet");
                        }
                    }
                }
            })
        });

    // Redir route gives the user the opportunity to accept the invalid
    // TLS certificate, which allows the github pages code to open a
    // WebSocket here
    let redir_route = warp::path::end()
        .and(warp::get())
        .and(warp::filters::host::optional())
        .map(|host| {
            println!("Client trusted certificate. Redirect issued.");
            match host {
                Some(host) => warp::reply::with_header(
                    warp::http::StatusCode::TEMPORARY_REDIRECT,
                    "Location",
                    if cfg!(debug_assertions) {
                        String::from("http://127.0.0.1:5173")
                    } else {
                        format!("https://sploders101.github.io/wslinux#{host}")
                    },
                ),
                None => panic!("Missing :authority header"),
            }
        });

    print_qr();

    warp::serve(redir_route.or(ws_route))
        .tls()
        .cert(include_bytes!("../data/cert.pem"))
        .key(include_bytes!("../data/key.pem"))
        .run(([0, 0, 0, 0], 3030))
        .await;
}

fn print_qr() {
    let interface = pnet::datalink::interfaces()
        .into_iter()
        .inspect(|interface| {
            // Print the interfaces we find for the user's convenience
            if interface.is_up() {
                for ip in interface.ips.iter() {
                    println!("{}: {}", &interface.name, ip);
                }
            }
        })
        .find(|iface| iface.is_up() && !iface.is_loopback() && !iface.ips.is_empty());

    if let Some(interface) = interface {
        if let Some(ipnet) = interface.ips.get(0) {
            let url = format!("https://{}:3030/", ipnet.ip());
            if let Ok(qrcode) = QrCode::new(&url) {
                let image = qrcode
                    .render()
                    .dark_color(qrcode::render::unicode::Dense1x2::Dark)
                    .light_color(qrcode::render::unicode::Dense1x2::Light)
                    .build();
                println!("{url}");
                println!("{}", image);
                return;
            }
        }
    }
    println!("Error while finding the default interface. Could not print QR code.");
}

fn parse_options(opts: &str) -> impl Iterator<Item = MountOption> {
    let mut options = HashSet::<MountOption>::from_iter([
        MountOption::FSName(String::from("Wsfs")),
        MountOption::AllowOther,
        MountOption::DefaultPermissions,
        MountOption::Suid,
        MountOption::Exec,
        MountOption::Async,
        MountOption::NoAtime,
        MountOption::AutoUnmount,
    ]);
    for option in opts.split(',') {
        let option = option.trim();
        match option {
            "allow-other" => {
                options.insert(MountOption::AllowOther);
            }
            "no-allow-other" => {
                options.remove(&MountOption::AllowOther);
            }
            "defaults" => {}
            "atime" => {
                options.remove(&MountOption::NoAtime);
                options.insert(MountOption::Atime);
            }
            "noatime" => {
                options.insert(MountOption::NoAtime);
                options.remove(&MountOption::Atime);
            }
            "" => {}
            _ => panic!("Unknown option {option:?}"),
        }
    }
    return options.into_iter();
}

struct WsMessageHandler {
    request_id: u16,
    callbacks: HashMap<u16, FsCallback>,
    receiver: Receiver<Ipc>,
    _handle: BackgroundSession,
}
impl WsMessageHandler {
    fn new(mountpoint: &str, options: &[MountOption]) -> Self {
        let (sender, receiver) = mpsc::channel(5);
        let wsfs = Wsfs::<WsfsDriver>::new(WsfsDriver { sender });
        let handle =
            fuser::spawn_mount2(wsfs, mountpoint, options).expect("Could not mount filesystem");
        return Self {
            request_id: 0,
            receiver,
            _handle: handle,
            callbacks: HashMap::new(),
        };
    }

    async fn process_message(&mut self, message: Vec<u8>) -> Option<()> {
        let mut packet = PacketReader::new(&message);
        let command = packet.read_u8()?;
        match command {
            constants::actions::INTERNALS => {
                let subcommand = packet.read_u8()?;
                match subcommand {
                    constants::internals::REPLY => {
                        let _reply_type = packet.read_u8()?;
                        let response_id = packet.read_u16()?;
                        let callback = self.callbacks.remove(&response_id)?;
                        callback.respond(packet);
                    }
                    _ => return None,
                }
            }
            _ => return None,
        }

        return Some(());
    }

    async fn process_requests(&mut self) -> Vec<u8> {
        loop {
            let message = self
                .receiver
                .recv()
                .await
                .expect("Couldn't receive message");
            match message {
                Ipc::GetRequestId(responder) => {
                    while self.callbacks.contains_key(&self.request_id) {
                        self.request_id = self.request_id.wrapping_add(1);
                    }
                    responder.send(self.request_id).unwrap();
                    self.request_id = self.request_id.wrapping_add(1);
                }
                Ipc::SendPacket(packet) => {
                    return packet;
                }
                Ipc::SendCallback(request_id, callback) => {
                    self.callbacks.insert(request_id, callback);
                }
            }
        }
    }
}

enum Ipc {
    GetRequestId(oneshot::Sender<u16>),
    SendPacket(Vec<u8>),
    SendCallback(u16, FsCallback),
}

struct WsfsDriver {
    sender: Sender<Ipc>,
}
impl FsComms for WsfsDriver {
    fn send_packet(&mut self, packet: Vec<u8>) {
        self.sender.blocking_send(Ipc::SendPacket(packet)).unwrap();
    }
    fn add_callback(&mut self, response_id: u16, callback: FsCallback) {
        self.sender
            .blocking_send(Ipc::SendCallback(response_id, callback))
            .unwrap();
    }
    fn get_available_rid(&self) -> u16 {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .blocking_send(Ipc::GetRequestId(sender))
            .unwrap();
        return receiver.blocking_recv().unwrap();
    }
}
