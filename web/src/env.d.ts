// Bun's file loader: importing the wasm or an svg yields its hashed URL.
declare module "@automerge/automerge/automerge.wasm" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.css";
