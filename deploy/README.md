# DeepMuse VPS 部署记录

## 当前环境

- 域名：`https://chat.ageha.cn`
- 服务器：`13.125.168.104`（Debian 12，用户 `admin`）
- 部署目录：`/opt/deepmuse`
- 镜像：`deepmuse:latest`（构建参数 `DM_DEFAULT_PROTOCOL=openai`）
- 容器：`deepmuse`，监听 `127.0.0.1:8080`
- Docker 网络：`cloud_default`（与现有 Caddy 容器共用）
- 反向代理：Caddy 容器，配置 `/opt/cloud/Caddyfile`
- 上游：`https://tsuki.ageha.cn`
- 模型：`agnes-3.0-flash`
- Key：只保存在 `/opt/deepmuse/.env`，权限 600

## DNS

Cloudflare 记录：

| 类型 | 名称 | 值 | 代理状态 |
| --- | --- | --- | --- |
| A | chat | 13.125.168.104 | DNS only |

Caddy 通过 HTTP-01 自动签发并续期 Let's Encrypt 证书。

## 常用命令

```bash
# 查看状态
cd /opt/deepmuse
sudo docker compose ps
curl -s http://127.0.0.1:8080/healthz

# 修改模型后重建容器
sudo sed -i 's/^MODEL=.*/MODEL=你的模型名/' /opt/deepmuse/.env
sudo docker compose up -d --force-recreate deepmuse

# 更新代码后重新构建
cd /opt/deepmuse
sudo docker build --build-arg DM_DEFAULT_PROTOCOL=openai -t deepmuse:latest .
sudo docker compose up -d --force-recreate deepmuse

# 查看日志
sudo docker logs --tail 100 deepmuse
sudo docker logs --tail 100 caddy
```

## 注意

- `.env` 含 API Key，不要提交到 Git、不要打印到日志。
- 如果轮换 Key，修改 `.env` 后执行 `docker compose up -d --force-recreate deepmuse`。
- 当前限流为每 IP 30 次/分钟；公开站点建议再加访问密码或 Cloudflare WAF。
