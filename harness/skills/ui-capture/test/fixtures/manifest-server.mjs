// .ui-capture.json の launch から起動されるフィクスチャ用サーバ。
// PORT 環境変数で listen し、立ち上がったら stdout に "ready on" を
// 含む行を出す(manifest.ready の substring 一致テスト対象)。
// SIGTERM で確実に終了する(capture.mjs の stop() が使う既定の
// プロセスグループ kill を、テストが「子は消えたか」で検証できるように)。

import http from "node:http";

const port = Number(process.env.PORT);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<h1>ui-capture manifest fixture</h1>");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ready on ${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
