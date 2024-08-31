(async () => {
	const fs = await openIdbFs("idbfs");
	const textContents = "Hello, world!";
	const textArr = textContents.split("").map((char) => char.charCodeAt(0));
	let contents = new Uint8Array(textArr.length);
	contents.set(textArr);
	fs.writeFileAll("/test", contents);
})();
