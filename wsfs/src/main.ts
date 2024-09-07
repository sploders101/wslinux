import './style.css'

import { IdbFs, S_IFREG, openIdbFs } from "./idbfs";

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
	const { fh } = await fs.open(file.id, 0);
	const bytesWritten = await fs.write(file.id, fh, 0, contents);
	console.log(`Wrote ${bytesWritten} bytes`);
	const bytes = await fs.read(file.id, fh, 0, 512);
	const decoder = new TextDecoder();
	console.log(`Saved file and read it back:\n\n${decoder.decode(bytes)}`);
	await fs.release(file.id, fh, 0);
	localStorage.setItem("readme-written", "yes");
}

async function readDemo(fs: IdbFs) {
	const rootDir = await fs.opendir(1, 0);
	const files = await fs.readdir(1, rootDir.fh);
	const readme = files.find((node) => node.name === "readme.md");
	if (readme !== undefined && readme.type === S_IFREG) {
		const { fh } = await fs.open(readme.ino, 0);
		const readmeData = await fs.read(readme.ino, fh, 0, 512);
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

	const button = document.createElement("button");
	button.innerText = "Open readme";
	button.addEventListener("click", () => readDemo(fs));
	document.body.appendChild(button);
	
})();
