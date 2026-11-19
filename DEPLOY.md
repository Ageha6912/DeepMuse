# DeepMuse 部署与域名接入

## 架构

```text
浏览器  ──同源请求──>  Node 服务（你的域名）
                         ├─ 托管 dist 静态文件
                         └─ /api/*  ──注入 API Key──> 上游模型 API
```

- API Key 只存在服务器环境变量 `API_KEY` 中，前端构建产物不包含 Key。
- 浏览器请求 `/api/...`，服务端补上 `Authorization` / `x-api-key` 后转发。
- 前端在服务端模式下隐藏 API Key、服务地址和协议设置，用户打开即可对话。
- 附件上传、语音 ASR/TTS、Anthropic Messages、OpenAI Chat Completions 都按原路径透传。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `API_KEY` | 是 | 上游服务的 API Key，只在服务器保存 |
| `UPSTREAM_ORIGIN` | 否 | 上游根地址，默认 `https://api.deepseek.com`；不要带 `/v1` |
| `MODEL` | 否 | 强制使用的模型名，设置后会覆盖前端传来的 model |
| `RATE_LIMIT_PER_MINUTE` | 否 | 每 IP 每分钟请求上限，默认 30 |
| `MAX_BODY_MB` | 否 | 请求体上限，默认 32 MB（影响附件上传） |
| `PORT` | 否 | 监听端口，默认 8080 |
| `HOST` | 否 | 监听地址，默认 `0.0.0.0` |
| `STATIC_DIR` | 否 | 静态目录，默认项目下的 `dist` |

构建时还可以设置 `DM_DEFAULT_PROTOCOL=openai`，让前端固定走 OpenAI Chat Completions；默认是 Anthropic Messages。

## 本地验证

```bash
pnpm install
pnpm build:server

# Anthropic / DeepSeek 官方
API_KEY=sk-你的Key \
UPSTREAM_ORIGIN=https://api.deepseek.com \
MODEL=deepseek-flash \
pnpm start
```

打开 `http://localhost:8080`，应该不再弹出 API Key 设置，直接可以发消息。

如果你的服务只支持 OpenAI 协议：

```bash
DM_DEFAULT_PROTOCOL=openai pnpm build:server

API_KEY=sk-你的Key \
UPSTREAM_ORIGIN=https://api.example.com \
MODEL=你的模型名 \
pnpm start
```

`UPSTREAM_ORIGIN` 只填根地址，例如 `https://api.example.com`，不要填 `/v1`。

## 方案 A：Render 部署（推荐，最少运维）

1. 把 `chat-demo` 目录推到 GitHub 仓库。
2. Render 控制台 → **New** → **Web Service** → 连接该仓库。
3. Runtime 选 **Docker**。仓库里的 `Dockerfile` 会先执行 `pnpm build:server`，再启动 `node server/index.mjs`。
4. 在 **Environment** 中添加：
   - `API_KEY` = 你的 Key
   - `UPSTREAM_ORIGIN` = `https://api.deepseek.com` 或你的服务根地址
   - `MODEL` = 例如 `deepseek-flash`
   - 可选：`RATE_LIMIT_PER_MINUTE`、`MAX_BODY_MB`
5. 部署完成后先用 `https://你的服务.onrender.com/healthz` 确认返回 `{"ok":true,...}`。
6. **Settings → Custom Domains → Add Custom Domain**，填 `chat.你的域名.com`。
7. 到域名 DNS 控制台添加记录：
   - 子域名：`CNAME`，主机记录 `chat`，值填 Render 显示的 `xxx.onrender.com`
   - 主域名：按 Render 提示添加 `ALIAS/ANAME` 或它给出的 A 记录
8. 等 DNS 生效，Render 会自动签发 HTTPS 证书。

如果使用 OpenAI 协议，Render 的 Docker 构建需要带 build arg：

```bash
DM_DEFAULT_PROTOCOL=openai
```

如果控制台不支持 build arg，直接把 `Dockerfile` 里的 `ARG DM_DEFAULT_PROTOCOL=anthropic` 改成 `openai` 后提交。

## 方案 B：自己的 VPS / 云服务器

以 Ubuntu + Nginx 为例：

```bash
# 1. 安装 Node 22 与 pnpm
# 2. 拉代码并构建
git clone <你的仓库> /opt/deepmuse
cd /opt/deepmuse
pnpm install
DM_DEFAULT_PROTOCOL=openai pnpm build:server   # 按上游协议选择

# 3. 先手动启动确认
API_KEY=sk-你的Key \
UPSTREAM_ORIGIN=https://api.deepseek.com \
MODEL=deepseek-flash \
PORT=8080 node server/index.mjs
```

用 systemd 常驻：

```ini
# /etc/systemd/system/deepmuse.service
[Unit]
Description=DeepMuse
After=network.target

[Service]
WorkingDirectory=/opt/deepmuse
Environment=API_KEY=sk-你的Key
Environment=UPSTREAM_ORIGIN=https://api.deepseek.com
Environment=MODEL=deepseek-flash
Environment=PORT=8080
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now deepmuse
```

Nginx 反向代理：

```nginx
server {
  listen 80;
  server_name chat.你的域名.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;          # SSE 流式输出必须关闭缓冲
    proxy_read_timeout 300s;
  }
}
```

```bash
certbot --nginx -d chat.你的域名.com
```

DNS：在域名控制台给 `chat` 添加 `A` 记录指向服务器公网 IP；主域名同理。等生效后 `https://chat.你的域名.com` 即可访问。

> 如果服务器在中国大陆，域名需要先完成 ICP 备案；中国香港或海外服务器不需要备案，但延迟和网络稳定性要自行评估。

## 安全与成本

- **API Key 不会下发到浏览器**，代理也只放行聊天、附件、语音和模型列表这几条固定路径，不能当成通用上游代理使用。
- 公开站点仍然会消耗你的余额。务必保留限流，必要时加访问密码、登录或 Cloudflare WAF。
- 当前限流是单进程内存计数，多实例部署时会各算各的；规模上来后改用 Redis 或网关限流。
- 建议在模型服务商后台设置每日预算/告警，防止被刷。
- 不要在前端代码、截图、日志里出现 `API_KEY`。
- 修改 Key 后只需更新服务器环境变量并重启，不用重新构建前端。
