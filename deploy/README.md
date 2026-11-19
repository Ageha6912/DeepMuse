# DeepMuse 部署说明

本文记录用 Docker + Caddy 部署 DeepMuse 的通用方式。示例中的域名、服务器地址与上游均为占位符，请按自己的环境替换。

## 环境

- 域名：`chat.example.com`（替换为你的域名）
- 服务器：一台可访问公网的 Linux 主机，安装 Docker 与 Docker Compose
- 部署目录：`/opt/deepmuse`（可自定义）
- 镜像：`deepmuse:latest`，构建参数按需选择协议：
  - `DM_DEFAULT_PROTOCOL=anthropic`（默认）
  - `DM_DEFAULT_PROTOCOL=openai`（上游只提供 OpenAI Chat Completions 时使用）
- 容器：`deepmuse`，监听容器内的 `8080`
- 反向代理：Caddy 容器，负责 HTTPS 与域名转发
- 上游：你的模型服务根地址，例如 `https://api.example.com`
- 模型：你的服务支持的模型名

## 环境变量

在项目根目录创建 `.env`（**不要提交到 Git**）：

```dotenv
API_KEY=你的上游密钥
UPSTREAM_ORIGIN=https://api.example.com
MODEL=你的模型名
```

`.env` 只保存在服务器上，权限建议设为 `600`。轮换密钥后重建容器即可生效。

## DNS 与 HTTPS

添加一条指向服务器的 A 记录。Caddy 通过 HTTP-01 自动签发并续期 Let's Encrypt 证书。

反向代理示例（Caddyfile）：

```caddyfile
chat.example.com {
  encode zstd gzip
  reverse_proxy deepmuse:8080
  request_body {
    max_size 32MB
  }
}
```

## 常用命令

```bash
# 查看状态
cd /opt/deepmuse
sudo docker compose ps
curl -s http://127.0.0.1:8080/healthz

# 构建并启动
sudo docker build --build-arg DM_DEFAULT_PROTOCOL=openai -t deepmuse:latest .
sudo docker compose up -d --force-recreate deepmuse

# 查看日志
sudo docker logs --tail 100 deepmuse
sudo docker logs --tail 100 caddy
```

## 注意

- `.env` 含 API Key，不要提交到 Git，也不要打印到日志。
- 默认限流为每个 IP 每分钟 30 次；公开站点建议再加访问密码或 WAF。
- 服务端代理只转发请求并注入密钥，不记录也不保存对话内容。
