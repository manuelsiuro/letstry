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
  server: { host: true, port: 5173, open: false },
  build: { target: "es2022", sourcemap: true },
  define: {
    __LAN_IP__: JSON.stringify(getLanIP()),
  },
});
