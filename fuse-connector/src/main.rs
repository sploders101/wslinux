mod fuse_driver;

use std::collections::HashMap;

use futures_util::{FutureExt, StreamExt};
use lazy_static::lazy_static;
use warp::Filter;

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let ws_route = warp::path("echo")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .map(|ws: warp::ws::Ws| {
            // And then our closure will be called when it completes...
            ws.on_upgrade(|websocket| {
                // Just echo all messages back...
                let (tx, rx) = websocket.split();
                rx.forward(tx).map(|result| {
                    if let Err(e) = result {
                        eprintln!("websocket error: {:?}", e);
                    }
                })
            })
        });

    // Redir route gives the user the opportunity to accept the invalid
    // TLS certificate, which allows the github pages code to open a
    // WebSocket here
    let redir_route = warp::path::end().and(warp::get()).map(|| {
        warp::reply::with_header(
            warp::http::StatusCode::TEMPORARY_REDIRECT,
            "Location",
            if cfg!(debug_assertions) {
                "http://127.0.0.1:5173"
            } else {
                "https://sploders101.github.io/wslinux"
            },
        )
    });

    warp::serve(redir_route.or(ws_route))
        .tls()
        .cert(include_bytes!("../data/cert.pem"))
        .key(include_bytes!("../data/key.pem"))
        .run(([0, 0, 0, 0], 3030))
        .await;
}
