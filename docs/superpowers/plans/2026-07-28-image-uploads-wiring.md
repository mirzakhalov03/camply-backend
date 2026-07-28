# Image uploads — implementation plan

Design: `../specs/2026-07-28-image-uploads-wiring-design.md`

Ordered so each phase is independently verifiable and nothing is wired to a
dependency that doesn't exist yet. **Phase 1 is the keystone** — until images can
be *read*, no upload surface can be confirmed working.

---

## Phase 1 — Backend: the read path

1. `services/upload.services.ts`
   - `parseKey(raw)` → `{ purpose, userId, filename }` or `null`. Strips
     `S3_PUBLIC_BASE_URL`, enforces the 3-segment `{purpose}/{24-hex}/{uuid}.{ext}`
     shape from §3.
   - rewrite `assertOwnedKey` on top of `parseKey` (same behavior, one parser).
   - `signDownloadUrl(key)` → presigned `GetObjectCommand`, 300s.
2. `controllers/upload.controllers.ts` → `getUpload` (503 unconfigured / 400 bad
   key / 302 + `Cache-Control: private, max-age=240`).
3. `routes/upload.routes.ts` → `router.get('/*key', requireAuth, getUpload)`.
   **Express 5: the wildcard must be named.**
4. `validators/upload.validators.ts` → export `uploadRefSchema`.
5. `validators/camp.validators.ts` → `coverImage` uses it (kills the `.url()` bug).
6. `validators/group.validators.ts` → `updateGroupSchema.photo`.
7. `services/group.services.ts` → `assertOwnedKey` on `patch.photo`.
8. `docs/openapi.ts` → register the new route + refreshed schemas.

**Verify:** `npm run typecheck`; then with a real session cookie,
`curl -i /api/uploads/<key>` → `302` with an `amazonaws.com` `Location`;
`curl -i /api/uploads/../../etc/passwd` → `400`; logged out → `401`.

## Phase 2 — Frontend: resolve + camera primitives

9. `lib/upload/resolveUploadUrl.ts` (§5.1 branch table).
10. `hooks/useImagePicker.ts` — two hidden inputs, gallery + camera.
11. `components/ui/PhotoSourceSheet.tsx` — on `(pointer: coarse)` only.
12. i18n: `sourceTitle` / `fromGallery` / `fromCamera` × UZ/RU/EN.
13. `ImageUploadField` — adopt the picker + source sheet.

**Verify:** `npm run typecheck`.

## Phase 3 — Profile photo

14. `ProfileForm` — drop `FileReader`, upload, store the key.
15. `IdentityCard` — same, plus persist via `useCompleteProfile`.
16. Every avatar `<img>` reading `useProfileStore.photo` → `resolveUploadUrl`.

**Verify:** pick a photo in signup → Network shows `presign` → S3 `PUT` (200) →
`PATCH /auth/me` carrying a **key**, not base64. Reload: photo still there.

## Phase 4 — Group photo

17. `GroupPhotoButton` — source sheet.
18. `ChatScreen` — drop `onPick` (participants read-only, §6).
19. `OrgChatScreen` — upload → `PATCH /camps/:id/groups/:gid { photo }`.
20. Delete `useGroupStore`; readers move to the group query + invalidate on success.

**Verify:** as a coordinator, set a group photo → reload → still there. As a
participant, the tile shows it and has no `+`.

## Phase 5 — Camp cover

21. `useCampDraftStore` — `CampDraftInfo.coverImage`.
22. `InfoStep` — delete `BannerUploader`, use `ImageUploadField`.
23. Commit path — send `coverImage` in the batch `POST /organizer/camps`.
24. `campHome.ts` / `CampCover` — render through `resolveUploadUrl`.

**Verify:** wizard → cover → refresh mid-wizard (still there) → Finish → the camp
home hero shows it.

## Phase 6 — Close out

25. `npm run validate` in **both** repos (lint + format:check + typecheck; it's the
    pre-commit hook). Format only touched files, `--end-of-line auto`.
26. Update both `CLAUDE.md` files: the upload read path, `resolveUploadUrl` as a
    required boundary, `useGroupStore`'s removal, and the §6 hierarchy call.
27. Report; do **not** commit (standing rule: no commits without permission).
