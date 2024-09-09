import './style.css'

import { IdbFs, S_IFMT, S_IFREG, openIdbFs } from "./idbfs";
import { connectFilesystem } from './idbfs-connector';
import { Entry } from './idbfs/types';

async function writeDemo(fs: IdbFs) {
	const textContents = [
		"# Wsfs",
		"",
		"This is Wsfs! It is a toy filesystem implemented entirely in javascript"
		+ "and uses a Rust-based FUSE driver to connect it to your PC! It is intended"
		+ "to be used for booting Linux using your phone's web browser as your system",
		"disk. For more details, see the following link:",
		"",
		"[WSLinux](https://github.com/sploders101/wslinux)",
	].join("\n");
	const encoder = new TextEncoder();
	const contents = encoder.encode(textContents);

	const file = await fs.mknod(0, 0, 1, "readme.md", S_IFREG | 0o0664, 0, 0);
	const { fh } = await fs.open(file.attr.ino, 0);
	const bytesWritten = await fs.write(file.attr.ino, fh, 0, contents);
	console.log(`Wrote ${bytesWritten} bytes`);
	const bytes = await fs.read(file.attr.ino, fh, 0, 512);
	const decoder = new TextDecoder();
	console.log(`Saved file and read it back:\n\n${decoder.decode(bytes)}`);
	await fs.release(file.attr.ino, fh, 0);
	localStorage.setItem("readme-written", "yes");
}

async function readDemo(fs: IdbFs) {
	let readmeEntry: Entry | null;
	try {
		readmeEntry = await fs.lookup(1, "readme.md");
	} catch(err) {
		readmeEntry = null;
	}
	if (readmeEntry !== null && (readmeEntry.attr.mode & S_IFMT) === S_IFREG) {
		const { fh } = await fs.open(readmeEntry.attr.ino, 0);
		const readmeData = await fs.read(readmeEntry.attr.ino, fh, 0, 512);
		const decoder = new TextDecoder();
		const decodedMessage = decoder.decode(readmeData);
		alert(`Found readme.md on the filesystem! It contains the following data:\n\n${decodedMessage}`);
	}
}

(async () => {
	const fs = await openIdbFs("idbfs");

	if (localStorage.getItem("readme-written") === null) {
		await writeDemo(fs);
	}

	const testButton = document.createElement("button");
	testButton.innerText = "Open readme";
	testButton.addEventListener("click", () => readDemo(fs));
	document.body.appendChild(testButton);

	const wsButton = document.createElement("button");
	wsButton.innerText = "Connect to server";
	wsButton.addEventListener("click", async () => {
		const ws = await new Promise<WebSocket>((res, rej) => {
			const ws = new WebSocket("ws://10.3.0.221:3030/echo");
			ws.addEventListener("open", () => res(ws));
			ws.addEventListener("error", () => rej());
		});
		connectFilesystem(ws, fs);
	});
	document.body.appendChild(wsButton);

})();
