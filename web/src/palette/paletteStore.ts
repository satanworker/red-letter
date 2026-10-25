// Cmd/Ctrl+K palette: open or closed. What it lists lives in Palette.tsx; main.tsx owns the shortcut.
import { createStore } from "solid-js/store";

const [state, set] = createStore({ open: false });
export const palette = state;
export const togglePalette = () => set("open", (o) => !o);
export const closePalette = () => set("open", false);
