// Cmd/Ctrl+K palette: open or closed. What it lists lives in Palette.tsx; main.tsx owns the shortcut.
import { createStore } from "solid-js/store";

// newTab: opened from the tab strip's "+", so a picked file gets a tab of its own
const [state, set] = createStore({ open: false, newTab: false });
export const palette = state;
export const togglePalette = () => set({ open: !state.open, newTab: false });
export const openInNewTab = () => set({ open: true, newTab: true });
export const closePalette = () => set("open", false);
