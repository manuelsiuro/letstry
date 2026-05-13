import { defineConfig } from "vite";
import os from "node:os";

function getLanIP(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

export default defineConfig({
  // Relative base lets Capacitor serve the build from file:// on Android.
  base: "./",
  server: { host: true, port: 5173, open: false },
  build: {
    target: "es2022",
    sourcemap: true,
    // three.js and pixi.js are each ~500 KB and unavoidable — bump the
    // warning threshold so the (now-correctly-split) vendor chunks don't
    // trigger noise on every build.
    chunkSizeWarningLimit: 700,
    // Split heavy vendor libs into their own chunks so app code can be
    // re-built / re-cached without re-downloading Three.js or PixiJS.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          pixi: ["pixi.js"],
        },
      },
    },
  },
  define: {
    __LAN_IP__: JSON.stringify(getLanIP()),
  },
});
