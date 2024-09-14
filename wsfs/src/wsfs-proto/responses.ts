import { ErrorCode } from "../idbfs/errors";
import { Entry, FsStats, NodeAttr, ReaddirEntry } from "../idbfs/types";
import { PacketBuilder } from "../packetizers";
import { constants } from "./constants";

/** Adds an attribute struct into the given packet */
function encodeAttr(packet: PacketBuilder, attr: NodeAttr) {
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
}

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
	encodeAttr(packet, attr);
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

export function statfs(ws: WebSocket, responseId: number, stat: FsStats) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.statfs);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u64(BigInt(stat.blocks));
	packet.u64(BigInt(stat.bfree));
	packet.u64(BigInt(stat.bavail));
	packet.u64(BigInt(stat.files));
	packet.u64(BigInt(stat.ffree));
	packet.u32(stat.bsize);
	packet.u32(stat.namelen);
	packet.u32(stat.frsize);
	ws.send(packet.getPacket());
}

export function xattr(ws: WebSocket, responseId: number, sizeOrData: number | Uint8Array) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.xattr);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	if (typeof sizeOrData === "number") {
		packet.u8(constants.xattrResponses.size);
		packet.u32(sizeOrData);
	} else {
		packet.u8(constants.xattrResponses.data);
		packet.buffer(sizeOrData);
	}
	ws.send(packet.getPacket());
}

export function error(ws: WebSocket, responseId: number, dataType: number, errCode: ErrorCode) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(dataType);
	packet.u16(responseId);
	packet.i32(errCode);
	ws.send(packet.getPacket());
}

export function create(ws: WebSocket, responseId: number, attr: NodeAttr, generation: number, fh: number, flags: number) {
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.create);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	encodeAttr(packet, attr);
	packet.u64(BigInt(generation));
	packet.u64(BigInt(fh));
	packet.u32(flags);
	ws.send(packet.getPacket());
}
