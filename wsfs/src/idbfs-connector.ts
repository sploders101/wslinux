import {
	IdbFs,
} from "./idbfs";

export function connectFilesystem(ws: WebSocket, fs: IdbFs) {
	ws.addEventListener("message", async (event) => {
		const data = new Uint8Array(await (event.data as Blob).arrayBuffer());
		console.log(data);
	});
}
