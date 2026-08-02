import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    // Без явного адреса Vite на этой системе слушает только IPv6 (::1),
    // и всё, что ходит по 127.0.0.1, получает отказ в соединении.
    // Чтобы открыть клиент с телефона, запустите: npm run dev:web -- --host
    host: "127.0.0.1",
    // Проксируем API и сокет на бэкенд, поэтому для браузера всё
    // приходит с одного адреса. Так httpOnly-cookie с refresh-токеном
    // работает без настройки CORS, а в продакшене оба слоя всё равно
    // окажутся за одним доменом — среда разработки совпадает с боевой.
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
      // Вложения отдаёт бэкенд. Без этого <img src="/uploads/…">
      // упирался бы в Vite и получал 404.
      "/uploads": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
