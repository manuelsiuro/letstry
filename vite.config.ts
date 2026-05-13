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
