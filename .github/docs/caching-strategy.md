# CI/CD Caching Strategy

## Overview

Caching được chia làm 2 lớp độc lập: **app-level** (npm, Jest, Next.js) và **Docker-level** (ECR + GHA). Hai lớp này dùng storage riêng nên không tranh nhau quota.

---

## App-level cache (GitHub Actions cache, 10GB limit)

### npm dependencies

Áp dụng tại: `build.yaml` (lint, test, sentry jobs), `sca-scan/action.yml` (Snyk step).

```
key:   {runner.os}-node-{hash(package-lock.json)}
path:  ~/.npm
```

Dùng `actions/setup-node` với `cache: npm` + `cache-dependency-path`. Invalidate khi `package-lock.json` thay đổi.

**`npm ci` vẫn luôn chạy sau bước cache restore — đây là behavior đúng, không phải bug.** `cache: npm` cache `~/.npm` (global package store), không phải `node_modules/`. `npm ci` đọc từ `~/.npm` trên disk thay vì download từ registry:

```
Cache miss  →  download từ registry  →  ~3-5 phút
Cache hit   →  extract từ ~/.npm     →  ~30-60 giây
```

**Tại sao không cache `node_modules/` trực tiếp** (sẽ skip `npm ci` hoàn toàn):

| | Cache `~/.npm` (hiện tại) | Cache `node_modules/` |
|---|---|---|
| `npm ci` vẫn chạy | Luôn luôn | Chỉ khi cache miss |
| Tiết kiệm khi hit | ~30-60s | ~60-90s |
| Kích thước cache | ~200-400MB | ~500MB-1GB+ |
| Post-install scripts | Luôn chạy | Bị skip khi hit |
| Rủi ro | Thấp | Cao — native modules (puppeteer-core, langchain bindings) có thể crash nếu runner image update mà cache cũ |

Repo này có nhiều native deps nên giữ nguyên `~/.npm` cache là đúng.

### Jest transform cache (NestJS backend)

Áp dụng tại: `build.yaml` test job.

```
key:           {runner.os}-jest-{hash(**/package-lock.json)}
restore-keys:  {runner.os}-jest-
path:          {working-directory}/.jest-cache
```

`be/package.json` cấu hình `"cacheDirectory": "<rootDir>/.jest-cache"` để Jest dùng đường dẫn cố định thay vì `/tmp/jest-*` ngẫu nhiên. `ts-jest` transform cache được persist giữa các runs, tránh recompile TypeScript test files.

Chỉ có data khi chạy với `working-directory: be`. Frontend không dùng `.jest-cache` → cache miss vô hại.

### Next.js incremental build cache (frontend sentry job)

Áp dụng tại: `build.yaml` sentry job, trước `npm run build`.

```
key:           {runner.os}-nextjs-{hash(**/package-lock.json)}-{github.sha}
restore-keys:  {runner.os}-nextjs-{hash(**/package-lock.json)}-
path:          {working-directory}/.next/cache
```

Key chứa `github.sha` để mỗi commit có cache riêng. Restore key fallback dùng lại build cache của commit gần nhất có cùng lockfile → Next.js incremental rebuild thay vì cold compile.

---

## Docker-level cache

### BuildKit cache modes

`mode=` chỉ áp dụng cho `cache-to` (write), không phải `cache-from`.

**`mode=min` (default):** Chỉ lưu layers của final stage.

```dockerfile
FROM node AS deps       # NOT cached
FROM node AS builder    # NOT cached
FROM node AS runner     # cached (final only)
```

**`mode=max`:** Lưu layers của tất cả stages, kể cả intermediate.

```dockerfile
FROM node AS deps       # cached
FROM node AS builder    # cached
FROM node AS runner     # cached
```

| | `mode=min` | `mode=max` |
|---|---|---|
| Lưu gì | Final stage only | Tất cả stages |
| Cache size | Nhỏ | Lớn (~2-3x) |
| Hit rate | Thấp hơn | Cao hơn |
| Phù hợp | Single-stage image | Multi-stage build |

Repo này dùng `mode=max` — `deps` stage (npm install / apt chromium) tốn nhất, phải được cache. Nếu dùng `mode=min`, thay đổi bất kỳ ở `deps` hoặc `builder` đều miss toàn bộ.

### Cache backends (`type=`)

| Backend | Lưu ở đâu | Quota | Persist |
|---|---|---|---|
| `type=gha` | GitHub cache servers | 10GB/repo | 7 ngày không dùng |
| `type=registry` | Container registry (ECR) | Unlimited | Cho đến khi xóa |
| `type=local` | Local filesystem | Disk của runner | Không persist |
| `type=s3` | S3 bucket | Unlimited | Cho đến khi xóa |

### ECR cache (`type=registry`, `mode=max`) — primary

Áp dụng tại: `.github/actions/build-push-ecr/action.yml` khi `ecr-cache-repository` được truyền vào.

```yaml
cache-from: type=registry,ref=<ECR>/<cache-repo>:<cache-tag>
cache-to:   type=registry,ref=<ECR>/<cache-repo>:<cache-tag>,mode=max
```

`mode=max` lưu toàn bộ intermediate layers của tất cả stages (deps, builder, runner). ECR cùng region với runner → write <1s.

**Tại sao không dùng production ECR repo làm cache backend:**
`ecr-global-api` bật **immutable tags** — BuildKit cần ghi đè tag `:cache` sau mỗi build, xung đột trực tiếp:

```
ERROR: The image tag 'cache' already exists in the 'ecr-global-api'
repository and cannot be overwritten because the tag is immutable.
```

**Giải pháp: dùng `ecr-global-otel-collector`** (mutable tags) làm dedicated cache repo, truyền qua input `ecr-cache-repository`. Logic trong action:

```
ecr-cache-repository set   →  cache-from: ECR only
                               cache-to:   ECR mode=max only
ecr-cache-repository empty →  cache-from/to: GHA mode=max
```

Ưu điểm ECR cache so với GHA:

- Không tính vào 10GB GHA quota
- Persist qua nhiều tuần, không bị LRU evict
- Runner (EC2) pull từ ECR cùng region nhanh hơn GitHub servers

**GHA quota thực tế cho repo này:**

| Cache | Ước tính |
|---|---|
| npm (×2 repos) | ~400MB |
| Jest | ~50MB |
| Next.js build | ~200MB |
| Trivy DB | ~100MB |
| Nuclei binary + templates | ~360MB |
| k6 binary | ~5MB |
| Docker GHA (fallback read only) | ~0MB (không ghi khi ECR set) |
| **Tổng** | **~1.1-1.3GB / 10GB** |

Dư nhiều so với giới hạn 10GB — không cần lo LRU eviction.

### Flow của build-push-ecr

Khi `ecr-cache-repository` được set (ci-nest.yaml, ci-next.yaml):

```
Build 1 (scan)
  cache-from: ECR:cache-be/fe
  cache-to:   ECR:cache-be/fe mode=max
  output:     load vào Docker daemon local → Trivy scan

Build 2 (push)
  cache-from: ECR:cache-be/fe   ← warm từ Build 1
  cache-to:   ECR:cache-be/fe mode=max
  output:     push lên ECR với tag thật
```

**Tag phân biệt per-image:**
Backend dùng `cache-be`, frontend dùng `cache-fe` trong cùng repo `ecr-global-otel-collector`. Tránh overwrite lẫn nhau khi cả hai workflow chạy song song.

---

## Semgrep pip cache

Áp dụng tại: `.github/actions/sca-scan/action.yml`, trước `pip install semgrep`.

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.x"
    cache: pip
```

`actions/setup-python` với `cache: pip` lưu wheel cache tại `~/.cache/pip`, tránh re-download ~30MB Semgrep wheels mỗi run.

---

## Nuclei binary + template cache

Áp dụng tại: `.github/actions/dast-scan/action.yml`.

```
Binary key:    nuclei-bin-3.9.0-linux-amd64      (invalidate khi bump version)
Binary path:   ~/nuclei-bin

Template key:  nuclei-templates-3.9.0-{YYYY-WNN}  (rotate weekly)
Template path: ~/.local/nuclei-templates
```

Binary cache (~10MB): install từ GitHub releases chỉ khi cache miss. Khi hit, `sudo install` từ `~/nuclei-bin` sang `/usr/local/bin/nuclei`.

Template cache (~350MB): `nuclei -update-templates` vẫn chạy mỗi lần nhưng chỉ fetch delta — không full clone. Key rotate theo tuần để templates không bị stale quá 7 ngày.

---

## k6 binary cache

Áp dụng tại: `.github/actions/perf-test/action.yml`.

```
key:   k6-linux-amd64-{YYYY-WNN}   (rotate weekly để pick up security patches)
path:  ~/k6-bin
```

Apt install chỉ chạy trên cache miss; binary được copy vào `~/k6-bin` để persist. Trên cache hit, `sudo install` từ `~/k6-bin` sang `/usr/local/bin/k6`. Weekly rotation đảm bảo k6 không quá 1 tuần tuổi.

---

## Docker BuildKit mount cache (Dockerfile)

Cache nằm trong BuildKit daemon — **không tính vào GHA 10GB quota**, persist suốt vòng đời của BuildKit daemon trên runner.

### `fe/Dockerfile` — Next.js incremental build

```dockerfile
RUN --mount=type=cache,id=nextjs-fe,target=/app/.next/cache \
    npm run build
```

Next.js đọc và ghi `.next/cache` qua mount, tăng tốc compile giữa các builds có cùng source. `id=nextjs-fe` isolate cache với backend.

### `be/Dockerfile` — apt-get packages

```dockerfile
RUN --mount=type=cache,id=apt-be,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-be-lists,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends chromium tini
```

Apt index và downloaded packages được cache trong mount — không cần `rm -rf /var/lib/apt/lists/*` vì lists không nằm trong image layer. `sharing=locked` tránh concurrent write conflicts.

---

## Trivy vulnerability DB cache

Áp dụng tại: `.github/actions/sca-scan/action.yml` (2 fs-scan steps), `.github/actions/build-push-ecr/action.yml` (image-scan step).

```yaml
cache: "true"
```

`aquasecurity/trivy-action` tự quản lý cache tại `~/.cache/trivy` qua `actions/cache`. Tránh download DB (~100MB) mỗi run.

---

## Lỗi đã gặp và lý do thay đổi

### 1. ECR immutable tag error

**Triệu chứng:**
```
ERROR: The image tag 'cache' already exists in the 'ecr-global-api'
repository and cannot be overwritten because the tag is immutable.
```

**Nguyên nhân:** `ecr-global-api` bật immutable tags. BuildKit `cache-to: type=registry` cần ghi đè tag `:cache` sau mỗi build — xung đột trực tiếp.

**Fix:** Dùng `ecr-global-otel-collector` (mutable tags) làm dedicated cache repo thay vì production repo. Truyền qua input `ecr-cache-repository`.

---

### 2. Docker build hang sau khi ECR write xong

**Triệu chứng:** Build log kẹt tại `#24 exporting to GitHub Actions Cache` >20s/layer sau khi `#25 exporting cache to registry` (ECR) đã done trong <1s.

**Nguyên nhân:** `cache-to` lúc đó ghi vào cả ECR lẫn GHA đồng thời. ECR cùng region xong ngay, nhưng GHA upload từng layer qua HTTPS:
- Layer Chromium: ~255MB
- Layer node_modules: ~124MB

Hai write độc lập không đợi nhau — pipeline block cho đến khi GHA upload xong.

**Fix:** Khi `ecr-cache-repository` được set, `cache-to` chỉ ghi ECR. GHA không còn được dùng cho Docker layer cache.

---

### 3. GHA fallback read bị xóa

**Nguyên nhân:** Sau khi fix #2, `cache-from` vẫn còn `type=gha` làm fallback read. Không còn cần thiết vì ECR là nguồn duy nhất — giữ lại chỉ làm phức tạp thêm mà không có lợi ích thực tế (GHA không bao giờ có Docker layer cache từ sau fix #2).

**Fix:** Xóa `type=gha` khỏi `cache-from` khi ECR được set.

---

## Tóm tắt tiết kiệm ước tính

| Cache               | Tiết kiệm/run (warm)          |
| ------------------- | ----------------------------- |
| npm (sca-scan)      | 1-3 phút                      |
| Jest transform      | 30-90 giây                    |
| Next.js build       | 1-4 phút                      |
| Trivy DB (x2 steps) | 30-60 giây                    |
| Docker ECR cache    | 2-5 phút (deps + build stage) |

---

## Tài liệu tham khảo

- [actions/setup-node caching](https://github.com/actions/setup-node#caching-global-packages-data)
- [actions/cache](https://github.com/actions/cache)
- [Jest cacheDirectory](https://jestjs.io/docs/configuration#cachedirectory-string)
- [Next.js CI caching](https://nextjs.org/docs/pages/building-your-application/deploying/ci-build-caching)
- [Docker BuildKit registry cache backend](https://docs.docker.com/build/cache/backends/registry/)
- [docker/build-push-action cache](https://github.com/docker/build-push-action#cache-from-and-cache-to)
- [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy-action)
- [ECR lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)
