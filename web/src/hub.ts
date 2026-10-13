// automerge-repo NetworkAdapter for the Red Letter hub: one WebSocket, many peers (every tab in the repo's room).
// The stock websocket adapter assumes a single remote peer that is an automerge-repo server; the hub is a dumb
// router, so tabs mesh-sync through it. Wire format (server/main.go):
//   text   join {token, peerId, peerMetadata} -> welcome {peers} | peer-joined | peer-left | error
//   binary out [len][targetId][cbor msg]   in [len][senderId][cbor msg]  (hub stamps the sender)
import { NetworkAdapter, cbor, type Message, type PeerId, type PeerMetadata } from "@automerge/automerge-repo/slim";

type Info = { peerId: PeerId; peerMetadata: PeerMetadata };

export class HubAdapter extends NetworkAdapter {
  #ws?: WebSocket;
  #ready = false;
  #readyWaiters: (() => void)[] = [];
  #peers = new Set<PeerId>();
  #closed = false;
  onStatus: (s: { connected: boolean; peers: number; error?: string }) => void = () => {};

  constructor(
    private url: string,
    private getToken: () => Promise<string | null>,
  ) {
    super();
  }

  isReady() {
    return this.#ready;
  }
  whenReady() {
    return this.#ready ? Promise.resolve() : new Promise<void>((r) => this.#readyWaiters.push(r));
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata ?? {};
    // Chrome keeps pages with open sockets in the back/forward cache; a hidden page must not stay a live peer.
    // Closing triggers the normal reconnect, which runs again if the page is restored.
    addEventListener("pagehide", () => this.#ws?.close(1000, "pagehide"));
    void this.#open();
  }

  async #open() {
    const token = await this.getToken();
    if (this.#closed || !token) return;
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token, peerId: this.peerId, peerMetadata: this.peerMetadata }));
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") return this.#control(JSON.parse(ev.data));
      const buf = new Uint8Array(ev.data);
      const sender = new TextDecoder().decode(buf.subarray(1, 1 + buf[0])) as PeerId;
      const msg = cbor.decode(buf.subarray(1 + buf[0])) as Message;
      this.emit("message", { ...msg, senderId: sender }); // never trust a claimed sender
    };
    ws.onclose = (ev) => {
      for (const p of this.#peers) this.emit("peer-disconnected", { peerId: p });
      this.#peers.clear();
      this.onStatus({ connected: false, peers: 0, error: ev.code >= 4000 ? ev.reason : undefined });
      // 4403/4409: auth or identity problem, don't hammer the hub
      if (!this.#closed && ev.code < 4000) setTimeout(() => void this.#open(), 2000 + Math.random() * 3000);
    };
    this.#markReady(); // the repo must not wait for peers: a tab alone works from the snapshot
  }

  #control(m: { type: string; peers?: Info[]; peerId?: PeerId; peerMetadata?: PeerMetadata; message?: string }) {
    if (m.type === "welcome") for (const p of m.peers ?? []) this.#candidate(p.peerId, p.peerMetadata);
    else if (m.type === "peer-joined") this.#candidate(m.peerId!, m.peerMetadata ?? {});
    else if (m.type === "peer-left" && this.#peers.delete(m.peerId!)) this.emit("peer-disconnected", { peerId: m.peerId! });
    else if (m.type === "error") console.warn("hub:", m.message);
    this.onStatus({ connected: true, peers: this.#peers.size });
  }

  #candidate(peerId: PeerId, peerMetadata: PeerMetadata) {
    this.#peers.add(peerId);
    this.emit("peer-candidate", { peerId, peerMetadata: peerMetadata ?? {} });
  }

  #markReady() {
    if (this.#ready) return;
    this.#ready = true;
    for (const r of this.#readyWaiters.splice(0)) r();
  }

  send(message: Message) {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.#peers.has(message.targetId)) return;
    const target = new TextEncoder().encode(message.targetId);
    const body = cbor.encode(message);
    const frame = new Uint8Array(1 + target.length + body.length);
    frame[0] = target.length;
    frame.set(target, 1);
    frame.set(body, 1 + target.length);
    ws.send(frame);
  }

  disconnect() {
    this.#closed = true;
    this.#ws?.close();
  }
}
