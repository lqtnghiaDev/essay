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

### Kiến trúc: ECR primary + GHA fallback

Áp dụng tại: `.github/actions/build-push-ecr/action.yml`.

| Layer    | Backend                 | `mode` | Mục đích                                            |
| -------- | ----------------------- | ------ | --------------------------------------------------- |
| Primary  | ECR `:<ecr-repo>:cache` | `max`  | Toàn bộ intermediate stages (deps, builder, runner) |
| Fallback | GHA `type=gha`          | `min`  | Chỉ final stage, dùng khi ECR cache chưa có         |

**Tại sao không dùng GHA `mode=max` cho Docker:**
GHA cache giới hạn 10GB/repo chung với npm/Jest/Next.js. NestJS image (có Chromium) + 3-stage build với `mode=max` chiếm 500MB-1GB, dễ đẩy npm/Jest cache ra khỏi quota (LRU eviction).

### ECR cache tag

Mỗi ECR repository sẽ có thêm tag `:cache` — đây là BuildKit cache manifest, không phải production image.

```
<account>.dkr.ecr.<region>.amazonaws.com/<repo>:cache
```

Nên thêm ECR lifecycle policy để dọn tag này định kỳ nếu cần kiểm soát storage:

```json
{
  "rules": [
    {
      "rulePriority": 10,
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["cache"],
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 30
      },
      "action": { "type": "expire" }
    }
  ]
}
```

### Flow của build-push-ecr

```
Build 1 (scan)
  cache-from: ECR:cache → GHA (fallback)
  cache-to:   ECR:cache mode=max + GHA mode=min
  output:     load vào Docker daemon local → Trivy scan

Build 2 (push)
  cache-from: ECR:cache → GHA (fallback)   ← warm từ Build 1
  cache-to:   GHA mode=min                 ← không ghi lại ECR
  output:     push lên ECR với tag thật
```

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
