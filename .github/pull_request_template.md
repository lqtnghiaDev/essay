## Summary

-

## Why

-

## Changes

-

## Affected area

- [ ] Backend (`be/` — NestJS API / WebSocket / RAG)
- [ ] Frontend (`fe/` — Next.js App Router)
- [ ] CI/CD or infrastructure (`.github/`)
- [ ] Docs only

## Testing

Backend (`cd be`):

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`

Frontend (`cd fe`):

- [ ] `npm run lint`
- [ ] `npm run build`

- [ ] Manual verification completed (if behavior changed)

## Risks / Notes

-

## Checklist

- [ ] PR title is clear and scoped
- [ ] Targets the correct base branch (`develop` for features, `main` for release)
- [ ] Docs updated for user-visible or API changes
- [ ] No secrets committed (`.env`, tokens, keys)
- [ ] DB migrations / new env vars documented if added
- [ ] Backward compatibility considered (response envelope, role-based access)
