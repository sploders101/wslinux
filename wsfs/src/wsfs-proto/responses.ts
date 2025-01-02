import { ErrorCode } from "../idbfs/errors";
import { Entry, FsStats, NodeAttr, ReaddirEntry } from "../idbfs/types";
import { PacketBuilder } from "../packetizers";
import { constants } from "./constants";

const debug = !!localStorage.getItem("debug-mode");
function audit(name: string, ...args: any) {
	if (debug) {
		console.log(name, args);
	}
}

function auditResponse(name: string, responseId: number, args: any) {
	audit("response", name, responseId, args);
	window.activeRequests.delete(responseId);
}

/** Adds an attribute struct into the given packet */
function encodeAttr(packet: PacketBuilder, attr: NodeAttr) {
	packet.u64(BigInt(attr.ino));
	packet.u64(BigInt(attr.size));
	packet.u64(BigInt(attr.blocks));
	packet.u64(BigInt(attr.atimeSecs));
	packet.u64(BigInt(attr.mtimeSecs));
	packet.u64(BigInt(attr.ctimeSecs));
	packet.u64(BigInt(attr.crtimeSecs));
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
	auditResponse("empty", responseId, null);
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
	auditResponse("entry", responseId, entry);
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(constants.replyTypes.entry);
	packet.u16(responseId);
	packet.i32(constants.replyStates.success);
	packet.u64(BigInt(entry.generation));
	encodeAttr(packet, entry.attr);
	ws.send(packet.getPacket());
}

/**
 * Responds to a message with a nodestat
 */
export async function attr(ws: WebSocket, responseId: number, attr: NodeAttr) {
	auditResponse("attr", responseId, attr);
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
	auditResponse("data", responseId, data);
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
	auditResponse("open", responseId, openResponse);
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
	auditResponse("write", responseId, bytesWritten);
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
	auditResponse("readdir", responseId, openResponse);
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
	auditResponse("statfs", responseId, stat);
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
	auditResponse("xattr", responseId, sizeOrData);
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
	auditResponse("error", responseId, { dataType, errCode });
	const packet = new PacketBuilder();
	packet.u8(constants.actions.internals);
	packet.u8(constants.internals.reply);
	packet.u8(dataType);
	packet.u16(responseId);
	packet.i32(errCode);
	ws.send(packet.getPacket());
}

export function create(ws: WebSocket, responseId: number, attr: NodeAttr, generation: number, fh: number, flags: number) {
	auditResponse("create", responseId, { attr, generation, fh, flags });
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
