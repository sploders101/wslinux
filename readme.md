# WSLinux

This project is a response to [this video from Brodie Robertson](https://www.youtube.com/watch?v=jhscJRB_fu4),
in which he discusses [this blog post](https://ersei.net/en/blog/fuse-root), which chronicles someone's attempt to boot
off of google-drive-ocamlfuse. At the end of the video, he offers a challenge. "Do you have any dumber ways you can
think of to boot Linux? I would certainly like to know, and if you do, I would like to see a blog post about it because
I want to talk about it."

**Challenge accepted.**


## My thought process

I wanted to do one better, but it doesn't get much worse than Google Drive. I thought of booting via serial over RF,
but that requires some specialized hardware and a lot of setup, and I wanted something that is easily replicated.

What if I could boot from my phone? [That's been done before.](https://play.google.com/store/apps/details?id=com.softwarebakery.drivedroid&hl=en_US)
Also, I have an iPhone at the moment and Apple's not too keen on letting you override the behavior of the USB port,
since that's how they make a lot of their money from the accessory market. Also, I want this to be replicable without
publishing some kind of app.

Continuing on the theme of "Cloud Native" and "the web", only one option remains... What if I could build a web app
that serves a FUSE filesystem via WebSocket? Then, I could serve it via Github pages and create a driver to consume the
files, with an initramfs similar to what they did for Google Drive.

Also, because it's built on web technologies, it can run on anything that supports them, like say... a Chromecast.

I want to be clear. This is a toy. It is not a real filesystem, and many features are likely missing. Also, you never
know what the browser is going to do. It might come around at some point and decide that the user hasn't used the app
in a few days, so they probably don't need it anyway, and wipe it all. This is NOT a good idea... but it's fun...


## Practicality

Is it realistically practical? No. But could it be? Yeah, if you need a rescue disk in a pinch and all you have is that
old 1GB flash drive you got at a trade show 5 years ago and a phone, this could do the trick!


## Design

There are a few problems we need to solve. However, because we're not stuck on Google Drive or a driver written by
someone else, we can implement whatever's missing (like symlinks, permission system, etc).

### 1. Connectivity

How do we host a network filesystem from a web browser? Well, we can't open raw TCP ports from a browser in either
direction, but what we can do is make an HTTP request. However, we need the diskless PC to initiate requests, so what
can we run via HTTP? WebSockets!

### 2. Storage

Web browsers aren't really meant to store large, multi-gig files, but I have seen PouchDB and WebVM do that very thing.
They both accomplished it with IndexedDB, so let's give that a shot.

### 3. Booting

Well, I already have experience building a custom initramfs for my Raspberry Pi based car stereo so it could repair
itself using an immutable underlay using a startup watchdog launched before init, but the solution from Ersei looks
even better since it would integrate with the existing system initramfs. I'll have to give that a look.


## Organization

So let's give it a shot! This will be a monorepo for the whole project, and descriptions for each component will go
here as they are created.

* `wsfs`: websocket file server
	* This is the web app to run on your phone which will serve as the file server
