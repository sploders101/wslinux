use std::{path::Path, process::Command};

fn main() {
    if !Path::new("./data/cert.pem").exists() {
        Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:4096",
                "-keyout",
                "data/key.pem",
                "-out",
                "data/cert.pem",
                "-sha256",
                "-days",
                "3650",
                "-nodes",
                "-subj",
                "/C=XX/ST=StateName/L=CityName/O=CompanyName/OU=CompanySectionName/CN=CommonNameOrHostname",
            ])
            .spawn()
            .expect("Couldn't run openssl")
            .wait_with_output()
            .expect("Couldn't generate certificates");
    }
}
