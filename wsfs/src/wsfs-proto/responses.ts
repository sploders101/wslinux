import { NodeAttr } from "../idbfs/types";
import { PacketBuilder } from "../packetizers";
import { constants } from "./constants";

/**
 * Responds to a message with a nodestat and generation
 */
export async function entry(responseId: number, ws: WebSocket, attr: NodeAttr, generation: number) {
    // [response_type: u8][response_id: u16]
    // [generation: u64][ino: u64][size: u64][blocks: u64][atimeMs: u64][mtimeMs: u64][ctimeMs: u64]
    // [crtimeMs: u64][mode: u32][nlink: u32][uid: u32][gid: u32][rdev: u32][blksize: u32]
    const packet = new PacketBuilder();
    packet.u64(BigInt(generation));
    packet.u8(constants.internals.reply);
    packet.u16(responseId);
    packet.u64(BigInt(attr.ino));
    packet.u64(BigInt(attr.size));
    packet.u64(BigInt(attr.blocks));
    packet.u64(BigInt(attr.atimeMs));
    packet.u64(BigInt(attr.mtimeMs));
    packet.u64(BigInt(attr.ctimeMs));
    packet.u64(BigInt(attr.crtimeMs));
    packet.u32(attr.mode);
    packet.u32(attr.nlink);
    packet.u32(attr.uid);
    packet.u32(attr.gid);
    packet.u32(attr.rdev);
    packet.u32(attr.blksize);
    ws.send(packet.getPacket());
}

/**
 * Responds to a message with a nodestat
 */
export async function attr(responseId: number, ws: WebSocket, attr: NodeAttr) {
    // [response_type: u8][response_id: u16]
    // [ino: u64][size: u64][blocks: u64][atimeMs: u64][mtimeMs: u64][ctimeMs: u64]
    // [crtimeMs: u64][mode: u32][nlink: u32][uid: u32][gid: u32][rdev: u32][blksize: u32]
    const packet = new PacketBuilder();
    packet.u8(constants.internals.reply);
    packet.u16(responseId);
    packet.u64(BigInt(attr.ino));
    packet.u64(BigInt(attr.size));
    packet.u64(BigInt(attr.blocks));
    packet.u64(BigInt(attr.atimeMs));
    packet.u64(BigInt(attr.mtimeMs));
    packet.u64(BigInt(attr.ctimeMs));
    packet.u64(BigInt(attr.crtimeMs));
    packet.u32(attr.mode);
    packet.u32(attr.nlink);
    packet.u32(attr.uid);
    packet.u32(attr.gid);
    packet.u32(attr.rdev);
    packet.u32(attr.blksize);
    ws.send(packet.getPacket());
}
