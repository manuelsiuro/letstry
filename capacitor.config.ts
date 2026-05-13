import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.letstry.cosmicpizza",
  appName: "Cosmic Pizza Delivery",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#0a0e1a",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
