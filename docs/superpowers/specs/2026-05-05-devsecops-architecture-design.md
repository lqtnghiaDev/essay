---
name: DevSecOps Architecture Design
description: Full-stack architecture + DevSecOps pipeline design for internship management platform (FE/BE/infra/observability)
type: project
---

# DevSecOps Architecture Design

**Date:** 2026-05-05  
**Scope:** System architecture + CI/CD pipeline documentation for NestJS/Next.js platform on AWS ECS

## Decision

Single `ARCHITECTURE.md` at repo root with embedded Mermaid diagrams. Covers system overview, FE/BE architecture, multi-environment infra, DevSecOps pipeline (security gates + perf testing), and observability stack.

**Why:** Architecture docs benefit from diagrams. Mermaid renders natively in GitHub. Single file keeps all architectural context in one place.

## Sections Covered

1. **System Overview** — component diagram: FE → BE → PostgreSQL/ChromaDB/AI/Observability
2. **Frontend Architecture** — App Router route structure, auth/role flow, data/real-time patterns
3. **Backend Architecture** — NestJS module map, RAG pipeline sequence diagram
4. **Infrastructure & Multi-Environment** — AWS ECR/ECS, OIDC auth, staging/production environment matrix, image tagging strategy
5. **DevSecOps Pipeline** — full flowchart PR→CI→build→staging→production with approval gate
6. **Security Gates** — Trivy FS (SCA), Snyk, Trivy container, OWASP ZAP DAST, SARIF uploads
7. **Performance Testing** — k6 post-deploy on staging, Grafana Cloud upload, reported metrics
8. **Dependency Management** — Dependabot weekly schedule, grouping strategy
9. **Observability Stack** — Jaeger/Prometheus/Grafana/ELK/Fluent Bit signal architecture

## Output

`ARCHITECTURE.md` at repo root.
