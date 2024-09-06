import './style.css'

import { S_IFREG, openIdbFs } from "./idbfs";

(async () => {
	const fs = await openIdbFs("idbfs");
	const textContents = [
		"# Wsfs",
		"",
		"This is Wsfs! It is a toy filesystem implemented entirely in javascript",
		"and uses a Rust-based FUSE driver to connect it to your PC! It is intended",
		"to be used for booting Linux using your phone's web browser as your system",
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
	console.log(`Read back message:\n\n${decoder.decode(bytes)}`);
	await fs.release(file.id, fh, 0);
})();
