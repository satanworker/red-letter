// Bun's file loader: importing the wasm yields its hashed URL.
declare module "@automerge/automerge/automerge.wasm" {
  const url: string;
  export default url;
}
