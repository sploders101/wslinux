import { Entry, NodeAttr, ReaddirEntry } from "../idbfs/types";
import { PacketBuilder } from "../packetizers";
import { constants } from "./constants";

/**
 * Sends empty response to signal completion of the requested task
 */
export async function empty(ws: WebSocket, responseId: number) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.empty);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	ws.send(packet.getPacket());
}

/**
 * Responds to a message with a nodestat and generation
 */
export async function entry(ws: WebSocket, responseId: number, entry: Entry) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.entry);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u64(BigInt(entry.generation));
	packet.u64(BigInt(entry.attr.ino));
	packet.u64(BigInt(entry.attr.size));
	packet.u64(BigInt(entry.attr.blocks));
	packet.u64(BigInt(entry.attr.atimeMs));
	packet.u64(BigInt(entry.attr.mtimeMs));
	packet.u64(BigInt(entry.attr.ctimeMs));
	packet.u64(BigInt(entry.attr.crtimeMs));
	packet.u32(entry.attr.mode);
	packet.u32(entry.attr.nlink);
	packet.u32(entry.attr.uid);
	packet.u32(entry.attr.gid);
	packet.u32(entry.attr.rdev);
	packet.u32(entry.attr.blksize);
	ws.send(packet.getPacket());
}

/**
 * Responds to a message with a nodestat
 */
export async function attr(ws: WebSocket, responseId: number, attr: NodeAttr) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.attr);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
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

export function data(ws: WebSocket, responseId: number, data: string | Uint8Array) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.data);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);

	if (typeof data === "string") {
		packet.string(data);
	} else {
		packet.buffer(data);
	}
	ws.send(packet.getPacket());
}

export function open(ws: WebSocket, responseId: number, openResponse: { fh: number, flags: number }) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.open);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u64(BigInt(openResponse.fh));
	packet.u32(openResponse.flags);
	ws.send(packet.getPacket());
}

export function write(ws: WebSocket, responseId: number, bytesWritten: number) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.write);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u32(bytesWritten);
	ws.send(packet.getPacket());
}

export function readdir(ws: WebSocket, responseId: number, openResponse: ReaddirEntry[]) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.readdir);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u16(openResponse.length);
	for (const entry of openResponse) {
		packet.u64(BigInt(entry.ino));
		packet.u32(entry.type);
		packet.string(entry.name);
	}
	ws.send(packet.getPacket());
}
