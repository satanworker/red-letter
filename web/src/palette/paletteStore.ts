// Cmd/Ctrl+K palette: open or closed. What it lists lives in Palette.tsx; main.tsx owns the shortcut.
import { createStore } from "solid-js/store";

const [state, set] = createStore({ open: false });
export const palette = state;
export const togglePalette = () => set("open", !state.open);
export const openInNewTab = () => set("open", true); // the tab strip's "+": every file opens in a tab of its own anyway
export const closePalette = () => set("open", false);
