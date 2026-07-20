# CPA / CPA Manager Plus 维护交接

> 最后核对时间：2026-07-18（Asia/Shanghai）
>
> 本文面向后续接手本仓库、本机 Docker 和 VPS 部署的 agent。先读完再操作。所有版本信息都只是本文生成时的快照，升级前必须重新查询官方发布状态。

## 1. 最重要的原则

1. **Plus 只在本机 Mac mini 构建，绝不在 VPS 构建。**
2. Docker 目标平台固定为 **`linux/amd64`**，构建后必须检查 manifest。
3. VPS 部署采用：预拉镜像、备份配置、校验 compose、只重建目标服务。
4. 升级 Plus 时不要顺手重启 CPA；升级 CPA 时也不要顺手重建 Plus。
5. 不要使用无服务名的 `docker compose up -d`，否则两个服务都可能被重建。
6. 不要丢失或覆盖 `/root/cpa/cmpdata/data.key`，也不要只备份 `usage.sqlite`。
7. Plus 对 CPA 认证目录必须保持只读挂载：`/root/cpa/auths:/auth-files:ro`。
8. 不要在日志、提交、文档或聊天里打印 CPA Management Key、Plus Admin Key、API Key 或 OAuth token。
9. 当前长期定制分支不应 force push；上游升级使用 merge，保留清晰的合并历史和回滚点。
10. 仓库中的 `.trellis/` 当前是本机未跟踪目录，不要无意加入业务提交。

## 2. 当前代码与远端

仓库目录：

```text
/Users/zhuanzhi/Documents/projects/CPA-Manager-Plus
```

Git：

```text
当前分支: codex-auth-file-usage-quota-estimates
origin:   git@github.com:AndrewZhuCC/CPA-Manager-Plus.git
upstream: git@github.com:seakee/CPA-Manager-Plus.git
```

本文生成时：

```text
HEAD: 75bb4fe9 fix: fail-closed Codex limit estimates after mid-window usedPercent drops
origin/codex-auth-file-usage-quota-estimates: 已与 HEAD 同步
定制基线: 官方 v1.11.3（merge 409ef5f0）+ 多平台巡检/额度估算定制
官方最新 Plus release: v1.11.3
```

官方链接：

- Plus：https://github.com/seakee/CPA-Manager-Plus
- Plus v1.11.3：https://github.com/seakee/CPA-Manager-Plus/releases/tag/v1.11.3
- CPA：https://github.com/router-for-me/CLIProxyAPI
- CPA v7.2.86：https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.86

## 3. 当前 VPS 部署快照

SSH 别名：

```bash
ssh vps
```

部署目录和 compose：

```text
/root/cpa
/root/cpa/docker-compose.yml
```

当前服务：

| Compose 服务 | 容器名 | 当前镜像 | 监听 |
|---|---|---|---|
| `cli-proxy-api` | `cli-proxy-api` | `eceasy/cli-proxy-api:v7.2.86` | `127.0.0.1:8317` 等 |
| `cpa-manager-plus` | `cpa-cpa-manager-plus-1` | `andrewzzhu/cpa-manager-plus:v1.11.3-multi-provider-inspection.1` | `127.0.0.1:18317` |

本机已构建、**尚未推送到 Docker Hub** 的 A1 镜像（Keychain 阻塞 + 用户选择稍后再推）：

```text
andrewzzhu/cpa-manager-plus:v1.11.3-multi-provider-inspection.2
local Id: sha256:a7ee948262e5095e4b0e3f288d803a9a146d957ac509a2baa93bac577aa4d141
platform: linux/amd64
commit: 75bb4fe9
```

关键挂载：

```text
CPA:
  /root/cpa/config.yaml -> /CLIProxyAPI/config.yaml          rw
  /root/cpa/auths       -> /root/.cli-proxy-api             rw
  /root/cpa/logs        -> /CLIProxyAPI/logs                rw
  /root/cpa/plugins     -> /CLIProxyAPI/plugins             rw

Plus:
  /root/cpa/cmpdata     -> /data                            rw
  /root/cpa/auths       -> /auth-files                      ro
  CPA_AUTH_DIR=/auth-files
  USAGE_DB_PATH=/data/usage.sqlite
```

当前 CPA 插件：

```text
/root/cpa/plugins/linux/amd64/grok-inspection.so
```

因此 CPA 必须继续使用支持动态插件的普通 Linux 镜像，不能换成 `*_no-plugin` 构建。

外部入口：

```text
https://api.anzhi.app
```

## 4. 当前定制能力，升级时必须保留

相对官方 `v1.11.2` 的定制提交：

```text
113baa7e feat: show auth file usage estimates
28c909c4 feat: summarize remaining Codex quota
16d38368 fix: align Codex estimates with quota windows
48cf53eb fix: adapt quota estimates to v1.11
30bad72e feat(auth-files): preserve usage stats and creation time
9321c90a feat: support multi-provider account inspection
da149a39 fix: split inspection user agents by provider
8701d64e fix: avoid labeling healthy xai checks as errors
409ef5f0 Merge upstream v1.11.3 into custom quota branch
75bb4fe9 fix: fail-closed Codex limit estimates after mid-window usedPercent drops
```

### 4.1 认证文件页用量估算

- 每个认证文件显示已记录 token 和已记录费用。
- 根据当前额度窗口内的实际用量与已用百分比估算 5 小时、周窗口总 token 和价值。
- 5 小时额度可能不存在，必须允许显示为空，不能拿周额度或历史总成本硬算。
- 已记录费用是长期累计值，但推算分母必须使用对应当前重置窗口内的用量，不能用长期累计值除以当前百分比。
- **A1 fail-closed**：会话内记住每个 credential×窗口的 `usedPercent`/`resetAt`；若同一 `resetAt` epoch 内 `usedPercent` 骤降 ≥15 个百分点（福利/限流重置额度回补），该窗口停止估算 limit/remaining（显示 `--`），直到 `resetAt` 前进到新 epoch。
- 卡片布局、移动端布局和健康状态展示有专门适配。

主要维护点：

```text
apps/web/src/features/authFiles/
apps/web/src/features/authFiles/model/authFileUsageSummary.ts
apps/web/src/features/authFiles/hooks/useAuthFileUsageAnalytics.ts
apps/web/src/utils/quota/
```

### 4.2 配额页 Codex 汇总

- Codex 账号卡片上方显示 5 小时和周窗口的预计剩余价值、预计剩余 token。
- 汇总位置在“Codex 额度”标题下、账号卡片上方。
- 5 小时和周窗口分别计算，缺少 5 小时额度的账号不能污染汇总。

主要维护点：

```text
apps/web/src/features/quota/CodexQuotaAggregateSummary.tsx
apps/web/src/features/quota/codexQuotaAggregateModel.ts
apps/web/src/features/quota/QuotaPage.tsx
```

### 4.3 认证文件创建时间与统计保留

- 认证文件页同时显示创建时间和修改时间。
- 支持按创建时间升降排序。
- 创建时间由 Plus 读取 CPA auth 文件系统 birth time，因此依赖只读 auth 目录挂载和 `CPA_AUTH_DIR=/auth-files`。
- CPA 刷新认证文件列表后，成功/失败统计不应错误清零。

主要维护点：

```text
apps/manager-server/internal/service/proxy/auth_file_created_at.go
apps/manager-server/internal/service/proxy/birthtime_*.go
apps/web/src/features/authFiles/
```

### 4.4 Codex + xAI 多平台巡检

- 本地巡检和服务端定时巡检都支持 Codex、xAI 或两者同时选择。
- 新配置使用 `targetTypes`，同时保留旧 `targetType` 兼容字段。
- Codex 和 xAI 使用各自的 User-Agent。
- 旧 `userAgent` 只迁移为 Codex User-Agent。
- 使用率阈值仅适用于 Codex；xAI 依赖 billing/身份探测和错误分类。
- `billing_healthy` 是内部健康分类，不应存入或显示为“错误类型”。
- 最近请求 Header 中的 Trace 只是证据，不代表错误。

主要冲突热点：

```text
apps/manager-server/internal/model/codex_inspection.go
apps/manager-server/internal/service/codexinspection/
apps/web/src/features/monitoring/
apps/web/src/utils/quota/providerRequests.ts
apps/web/src/utils/quota/xaiErrors.ts
```

官方 `v1.11.3` 新增了付费 xAI OAuth 身份回退，这些文件很可能发生冲突。合并时必须把官方回退逻辑与我们的多平台选择、分平台 User-Agent、健康状态展示一起保留，不能简单选某一侧。

## 5. 数据语义与常见坑

### 5.1 额度估算

错误算法：

```text
账号历史总费用 / 当前窗口已用百分比
```

正确思路：

```text
当前窗口内已记录 token 或成本 / 当前窗口已用百分比
```

5 小时和周窗口独立重置，必须分别按时间条件查询。账号可能只有周窗口，没有 5 小时窗口。

OpenAI 福利/限流重置额度回补会导致 **同一日历窗口内** `usedPercent` 骤降而 `resetAt` 不变。若仍用 `window_usage / usedPercent` 估算，会把 limit 和 remaining 抬到虚高。A1 对策是骤降 fail-closed，不猜新分母。

### 5.2 Plus SQLite

当前目录约数百 MB，并启用了 WAL：

```text
/root/cpa/cmpdata/usage.sqlite
/root/cpa/cmpdata/usage.sqlite-wal
/root/cpa/cmpdata/usage.sqlite-shm
/root/cpa/cmpdata/data.key
```

备份必须包含全部文件。`data.key` 用于解密 Plus 保存的 CPA Management Key；丢失后只能重新配置 CPA 连接。

不要在 Plus 运行时只复制 `usage.sqlite`。高可靠备份应短暂停止 Plus 后打包整个 `cmpdata`，CPA 可以继续运行。

### 5.3 两种管理密钥不能混用

- Plus Admin Key：登录和调用 `18317` 的 Plus 管理服务。
- CPA Management Key：调用 `8317` 的 CPA management API。
- Plus 会保存 CPA Management Key，用于向 CPA 代理管理请求。
- 外部上传工具命中特殊直通 CPA 路由时，需要 CPA Management Key，不是 Plus Admin Key。

出现 `Invalid management key` 时，先确认请求究竟被 Caddy 路由到了 Plus 还是 CPA，不要直接重置密钥。

## 6. Caddy 路由，改动前必须理解

配置文件：

```text
/etc/caddy/Caddyfile
```

`api.anzhi.app` 当前顺序：

1. 请求体上限 `64MB`。
2. `/` 重定向到 `/management.html`。
3. `/management.html`、`/health`、`/status`、`/setup`、`/models` 进入 Plus `18317`。
4. `POST /v0/management/auth-files?name=*` 直接进入 CPA `8317`，用于注册工具上传 auth 文件。
5. `/usage-service/*`、`/v0/management/*`、`/v0/resource/plugins/*` 默认进入 Plus。
6. `/v1/*`、`/v1beta/*`、`/backend-api/codex/*`、`/api/*` 直接进入 CPA。
7. OAuth 回调和 `/healthz` 进入 CPA。
8. 其余请求兜底进入 CPA。

这条 POST 特例是为了避免上传工具拿 CPA Management Key 请求 Plus 后出现 `Invalid management key`。不要把所有 POST 都改成 Plus，也不要把所有 `/v0/management/*` 都直接改成 CPA，否则会失去 Plus 的增强接口。

Caddy 修改流程：

```bash
ssh vps "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-<timestamp>"
ssh vps "caddy validate --config /etc/caddy/Caddyfile"
ssh vps "systemctl reload caddy"
```

修改后至少检查：

```bash
curl -sS -L -o /dev/null -w '%{http_code}\n' https://api.anzhi.app/
```

## 7. Plus 上游升级流程

### 7.1 先比较，不要直接覆盖

```bash
cd /Users/zhuanzhi/Documents/projects/CPA-Manager-Plus
git status -sb
git fetch upstream --tags
git log --oneline HEAD..upstream/main
git log --oneline <current-official-tag>..<new-official-tag>
```

优先合并正式 release tag，不默认追随 `main`。

创建回滚分支：

```bash
git branch backup/pre-<new-version>-$(date +%Y%m%d)
```

合并示例：

```bash
git merge --no-ff v1.11.3
```

不要 rebase 后 force push。解决冲突时按第 4 节逐项验证定制能力。

### 7.2 本地质量门

```bash
npm ci
npm test
npm run type-check
npm run lint
npm run build

cd apps/manager-server
go test ./...
go vet ./...
```

补充检查：

```bash
git diff --check
git status --short
```

前端重点人工验证：

- 认证文件页 2 行 3 列用量估算。
- 只有周限、没有 5 小时限的账号。
- 配额页汇总位置和移动端布局。
- 创建时间显示与排序。
- Codex + xAI 同时巡检。
- Codex/xAI User-Agent 分开。
- xAI 健康结果不显示“错误类型”。

Demo 可用：

```bash
npm run dev:demo -- --host 127.0.0.1 --port 4178
```

```text
http://127.0.0.1:4178/#/demo/codex-inspection
http://127.0.0.1:4178/#/demo/codex-inspection/server
```

### 7.3 本机构建并推送镜像

只用精确 tag，不覆盖官方 `latest`：

```bash
IMAGE=andrewzzhu/cpa-manager-plus:<new-tag>

docker buildx build \
  --platform linux/amd64 \
  -f Dockerfile.manager-server \
  --build-arg VERSION=<new-tag> \
  -t "$IMAGE" \
  --push .
```

验证平台：

```bash
docker manifest inspect --verbose "$IMAGE"
```

必须看到：

```text
architecture: amd64
os: linux
```

Mac 的 Docker 凭证存储可能要求用户解锁 Security/Keychain。不要绕过，不要把 Docker Hub token 写进仓库。

### 7.4 VPS 最小停机部署 Plus

先记录 CPA 容器状态，用于确认未被重启：

```bash
ssh vps "docker inspect cli-proxy-api --format '{{.Id}} {{.State.StartedAt}}'"
```

预拉镜像，不产生停机：

```bash
ssh vps "docker pull $IMAGE"
```

备份 compose：

```bash
ssh vps "cp /root/cpa/docker-compose.yml /root/cpa/docker-compose.yml.pre-<change>-<timestamp>"
```

把 compose 中 Plus 的旧精确 tag 改为新 tag，然后：

```bash
ssh vps "docker compose -f /root/cpa/docker-compose.yml config --quiet"
ssh vps "docker compose -f /root/cpa/docker-compose.yml up -d --no-deps --force-recreate --pull never cpa-manager-plus"
```

验证：

```bash
ssh vps "wget -qO- http://127.0.0.1:18317/health"
ssh vps "docker compose -f /root/cpa/docker-compose.yml ps"
ssh vps "docker logs --tail 100 cpa-cpa-manager-plus-1"
curl -sS -L -o /dev/null -w '%{http_code}\n' https://api.anzhi.app/
```

最后再次检查 CPA 的容器 ID 和 `StartedAt` 未变化。

### 7.5 Plus 回滚

恢复 compose 备份或把镜像 tag 改回已验证的旧 tag，然后只重建 Plus：

```bash
ssh vps "docker compose -f /root/cpa/docker-compose.yml config --quiet"
ssh vps "docker compose -f /root/cpa/docker-compose.yml up -d --no-deps --force-recreate --pull never cpa-manager-plus"
```

当前可用回滚镜像：

```text
andrewzzhu/cpa-manager-plus:v1.11.3-multi-provider-inspection.1
andrewzzhu/cpa-manager-plus:v1.11.2-multi-provider-inspection.3
```

待 Hub 可用后的 A1 升级目标：

```text
andrewzzhu/cpa-manager-plus:v1.11.3-multi-provider-inspection.2
```

注意：Mac 本机 Docker Hub push 依赖登录钥匙串。若 agent 会话无法交互解锁 Keychain，需要用户本机执行 `security unlock-keychain` 或图形解锁后，明确说「继续 push」再推。禁止 `docker save | ssh` 旁路。

## 8. CPA 官方升级流程

CPA 当前没有需要维护的本地源码定制，VPS 使用官方 Docker 镜像。优先升级精确版本，不使用漂移的 `latest`。

本文生成时：

```text
VPS 当前: v7.2.86
官方最新: v7.2.86
```

`v7.2.81` 到 `v7.2.86` 包含 Kimi header、插件同步、xAI 图片/compact 修复、CPA Trace ID、WebSocket 连接跟踪、Codex executor 和并行 tool call 归一化等变化。升级前重新看每个 release note。

Plus `v1.11.3` 的完整 xAI API Key 管理依赖 CPA `/v0/management/xai-api-key`。升级 Plus 前应确认目标 CPA 版本支持该接口。

### 8.1 CPA 备份

至少备份：

```text
/root/cpa/config.yaml
/root/cpa/auths/
/root/cpa/plugins/
/root/cpa/docker-compose.yml
```

不要把 auth 文件或密钥内容输出到终端记录。高风险升级可短暂停止 CPA 后再做最终备份，但普通镜像 patch 通常只需预拉和精确回滚点。

### 8.2 最小停机升级 CPA

```bash
CPA_IMAGE=eceasy/cli-proxy-api:<new-version>

ssh vps "docker pull $CPA_IMAGE"
ssh vps "cp /root/cpa/docker-compose.yml /root/cpa/docker-compose.yml.pre-cpa-<new-version>-<timestamp>"
```

把 compose 中 CPA 镜像改为新精确 tag，然后：

```bash
ssh vps "docker compose -f /root/cpa/docker-compose.yml config --quiet"
ssh vps "docker compose -f /root/cpa/docker-compose.yml up -d --no-deps --force-recreate --pull never cli-proxy-api"
```

验证：

```bash
ssh vps "curl -fsS http://127.0.0.1:8317/healthz"
ssh vps "docker logs --tail 150 cli-proxy-api"
ssh vps "docker compose -f /root/cpa/docker-compose.yml ps"
```

日志中确认 `grok-inspection` 插件正常注册。Plus 容器 ID 应保持不变；CPA 重启期间 Plus 可能短暂显示上游不可用，这是预期现象。

### 8.3 CPA 回滚

把 compose 镜像改回旧精确 tag，或恢复升级前 compose，然后只重建 `cli-proxy-api`。

当前回滚基线：

```text
eceasy/cli-proxy-api:v7.2.80
```

## 9. Plus 数据备份与恢复

官方要求备份全部 SQLite/WAL 文件和 `data.key`。为了得到一致快照，建议短暂停止 Plus：

```bash
ssh vps "mkdir -p /root/cpa/backups"
ssh vps "docker compose -f /root/cpa/docker-compose.yml stop cpa-manager-plus"
ssh vps "tar czf /root/cpa/backups/cmpdata-<timestamp>.tar.gz -C /root/cpa cmpdata"
ssh vps "docker compose -f /root/cpa/docker-compose.yml start cpa-manager-plus"
```

这只影响 Plus 管理面板和统计，CPA API 仍可继续服务。

恢复前先保留当前损坏目录，不要直接覆盖：

1. 停止 Plus。
2. 把当前 `cmpdata` 改名保存。
3. 解压完整备份。
4. 检查文件属主和权限。
5. 启动 Plus，并检查 `/health` 和日志。

## 10. 本机备用 CPA stack

目录：

```text
/Users/zhuanzhi/Documents/projects/cpa
```

包含：

```text
config.yaml
auths/
logs/
cmpdata/
docker-compose.yml
```

本文生成时该 stack 未运行。它曾在 VPS 故障期间临时承接请求，属于应急/历史数据，不是当前生产真源。

注意：

- VPS 的 `/root/cpa` 是当前生产真源。
- 不要拿本机 `cmpdata/usage.sqlite` 覆盖 VPS 数据库。
- 如果以后再次临时切流，本机产生的事件应按 `event_hash` 去重、做行级迁移，并先在备份数据库验证；不要整库覆盖。
- 本机 `auths/` 可能落后于 VPS，恢复前必须比较文件名、修改时间和内容来源。

## 11. 常用只读检查

```bash
# 本地 Git
git status -sb
git remote -v
git log --oneline --decorate -20

# 官方最新版本
gh api repos/seakee/CPA-Manager-Plus/releases/latest --jq '{tag_name,published_at,html_url}'
gh api repos/router-for-me/CLIProxyAPI/releases/latest --jq '{tag_name,published_at,html_url}'

# VPS 服务
ssh vps "docker compose -f /root/cpa/docker-compose.yml ps"
ssh vps "docker inspect cli-proxy-api --format '{{.Config.Image}} {{.State.StartedAt}}'"
ssh vps "docker inspect cpa-cpa-manager-plus-1 --format '{{.Config.Image}} {{.State.StartedAt}}'"

# 健康检查
ssh vps "wget -qO- http://127.0.0.1:18317/health"
ssh vps "curl -fsS http://127.0.0.1:8317/healthz"
curl -sS -L -o /dev/null -w '%{http_code}\n' https://api.anzhi.app/
```

## 12. 已有 compose 回滚文件

VPS 当前已有：

```text
/root/cpa/docker-compose.yml.bak-20260714-133952
/root/cpa/docker-compose.yml.bak-auth-created-at-20260715-120326
/root/cpa/docker-compose.yml.pre-auth-stats-fix-20260715
/root/cpa/docker-compose.yml.pre-multi-provider-20260716-1643
/root/cpa/docker-compose.yml.pre-provider-user-agents-20260716-112431
/root/cpa/docker-compose.yml.pre-v1.11.1-auth-file-usage
/root/cpa/docker-compose.yml.pre-xai-healthy-label-20260716-115010
```

恢复前先打开备份确认其中镜像 tag 和挂载仍符合目标，不要只因为文件名接近就直接覆盖。

## 13. 下一位 agent 的建议起手式

1. 阅读 `AGENTS.md`、本文和 `.trellis/workflow.md`。
2. 执行 `git status -sb`，不要覆盖用户或其他 agent 的未提交改动。
3. 查询 Plus、CPA 官方最新 release，不依赖本文快照。
4. 只读检查 VPS 两个容器、compose 和最近日志。
5. 一次只升级一个服务。
6. 任何写操作前说明范围、备份点和回滚方式。
7. 完成后记录 commit、镜像 tag、digest、平台、VPS 健康状态以及非目标容器是否保持原 ID。
