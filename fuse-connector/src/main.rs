mod binary_packets;
mod constants;
mod fuse_driver;

use std::collections::HashMap;

use binary_packets::PacketReader;
use fuse_driver::{FsCallback, FsComms, Wsfs};
use fuser::{BackgroundSession, MountOption};
use futures_util::{SinkExt, StreamExt};
use qrcode::QrCode;
use tokio::{
    select,
    sync::{
        mpsc::{self, Receiver, Sender},
        oneshot,
    },
};
use warp::{filters::ws::Message, Filter};

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let ws_route = warp::path("fshost")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .map(|ws: warp::ws::Ws| {
            // And then our closure will be called when it completes...
            ws.on_upgrade(|mut websocket| async move {
                println!("Connection established. Mounting filesystem.");
                let mut message_handler = WsMessageHandler::new();
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
            if let Ok(qrcode) = QrCode::new(format!("https://{}:3030/", ipnet.ip())) {
                let image = qrcode
                    .render()
                    .dark_color(qrcode::render::unicode::Dense1x2::Dark)
                    .light_color(qrcode::render::unicode::Dense1x2::Light)
                    .build();
                println!("{}", image);
                return;
            }
        }
    }
    println!("Error while finding the default interface. Could not print QR code.");
}

struct WsMessageHandler {
    request_id: u16,
    callbacks: HashMap<u16, FsCallback>,
    receiver: Receiver<Ipc>,
    _handle: BackgroundSession,
}
impl WsMessageHandler {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel(5);
        let wsfs = Wsfs::<WsfsDriver>::new(WsfsDriver { sender });
        let mountpoint = "/tmp/test";
        let options = &[
            MountOption::FSName(String::from("Wsfs")),
            MountOption::AllowOther,
            MountOption::DefaultPermissions,
            MountOption::Suid,
            MountOption::Exec,
            MountOption::Async,
            MountOption::NoAtime,
            MountOption::DirSync,
        ];
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
