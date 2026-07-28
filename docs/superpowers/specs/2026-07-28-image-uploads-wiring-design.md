# Image uploads — wiring the pipeline end to end (design)

**Date:** 2026-07-28
**Status:** approved, in implementation
**Scope:** identity photos (profile · group · camp cover) + the missing read path.
**Out of scope:** chat attachments (composer `+` menu) — next pass, see §9.

---

## 1. The problem

AWS is reconnected and the **write half** of uploads has been built for a while:

- `POST /api/uploads/presign` mints a short-lived, exact-`ContentLength`-signed PUT.
- `assertOwnedKey` guards `user.photo` and `camp.coverImage` against key theft.
- Frontend has `useUpload()`, `validateUpload`, and a finished `ImageUploadField`.

None of it is reachable from the UI, and the **read half doesn't exist at all.**

| Surface | Today | Consequence |
|---|---|---|
| `ImageUploadField` | imported by **zero** screens | the finished uploader is dead code |
| Profile photo (`IdentityCard`, `ProfileForm`) | `FileReader` → base64 into Zustand | photo dies with the browser; a base64 blob is sent to `PATCH /auth/me` |
| Group photo (`GroupPhotoButton`) | `URL.createObjectURL` → `useGroupStore` | blob URL, gone on reload; `Group.photo` has no write route |
| Camp cover (`InfoStep.BannerUploader`) | local blob preview | dropped before the wizard commits — never reaches the server |
| **Serving images back** | **nothing** | see below |

### 1.1 The root cause: presigning solves writing, not reading

A presigned PUT proves *"you may write this object."* Nothing in it grants
*"anyone may read it back."* `S3_PUBLIC_BASE_URL` is unset, so `presign()` returns
the **bare key** as `publicUrl`:

```
avatar/68a1f0c9e4b21a7d3c5e9f10/2b7c….jpg
```

Rendered as `<img src="avatar/68a1…/2b7c….jpg">` that resolves against the **app
origin**, not S3 — a broken image. Verified: the bucket is private.

```
$ curl -o /dev/null -w '%{http_code}' \
    https://camply-s3-bucket.s3.eu-north-1.amazonaws.com/probe-does-not-exist.jpg
403   →  <Code>AccessDenied</Code>
```

That missing read path is *why* every upload surface quietly fell back to
`FileReader` / `createObjectURL`: a blob URL renders instantly with no read path,
so the gap stayed invisible until the first reload.

### 1.2 The second landmine

`validators/camp.validators.ts:15` declares:

```ts
coverImage: z.string().url().nullable().optional()
```

A bare key is not a URL, so camp creation carrying a cover would **400 at
validation** even after the frontend was wired. `assertOwnedKey` already accepts
both forms; the validator is the odd one out.

---

## 2. Decision — serve through our API, keep the bucket private

**`GET /api/uploads/*key` → `requireAuth` → `302` to a short-lived presigned GET.**

```
<img src="/api/uploads/avatar/68a1…/2b7c….jpg">
        ↓  same-origin, session cookie rides along
   requireAuth
        ↓  302 Location
https://camply-s3-bucket.s3.eu-north-1.amazonaws.com/avatar/…?X-Amz-Signature=…
        ↓
   [image bytes, straight from S3 — never through our process]
```

**Rejected: public bucket + `S3_PUBLIC_BASE_URL`.** One bucket policy and the
existing code would work — but every camp photo becomes world-readable forever to
anyone holding the URL. Camp participants are frequently minors; root `CLAUDE.md`
makes privacy a product guarantee, not a setting. Not worth the two hours saved.

**Rejected for now: CloudFront + OAC.** The correct production answer and where
this should land eventually, but it needs a distribution, an origin access
control, a bucket policy, and probably a domain — real console work for a caching
win we don't need yet. §8 records the migration path, which is one env var.

### 2.1 Why a redirect and not a proxy

Streaming the bytes through Express would put every image on our request budget
and memory. The 302 costs one cheap round trip and hands the transfer to S3 —
the same reasoning that made **uploads** direct-to-S3 in the first place.

### 2.2 Authorization model, stated honestly

The check is **authenticated + unguessable key**, not per-resource ownership. Any
logged-in user who *knows* a key can fetch it; keys are `randomUUID()` and only
handed out by endpoints that already scope their responses.

This is deliberate for v1 and is a real (small) limitation. Per-object authz —
*"is this avatar owned by someone in a camp I'm in?"* — needs a reverse lookup
from key → owning resource on every image request, which is a query per `<img>`.
Revisit if uploads ever carry something more sensitive than a face and a banner.

What it **does** stop: anonymous scraping, logged-out access, and search-engine
indexing of camp photos. That's the threat that mattered.

### 2.3 Caching

Signed GETs expire in **300s**; the redirect is returned with

```
Cache-Control: private, max-age=240
```

— shorter than the signature, so the browser never replays a redirect to an
already-dead URL. `private` keeps shared proxies out of it. S3's own response is
then cached by the browser under the signed URL for as long as it lives.

---

## 3. Key shape is the security boundary

`GET /uploads/*key` takes attacker-controlled path text, so the handler validates
before signing anything:

```
{purpose}/{userId}/{uuid}.{ext}
```

- exactly **3** segments,
- `purpose` ∈ `UPLOAD_PURPOSES`,
- `userId` is 24-hex,
- filename is `uuid.ext` with `ext` in the allowed set.

Anything else → **400**, before an AWS call. This is what makes `..` traversal,
absolute keys, and probing of unrelated bucket prefixes non-events. The same
parser backs `assertOwnedKey`, so the two can't drift — one regex, one meaning.

---

## 4. Backend changes

| # | File | Change |
|---|---|---|
| 4.1 | `services/upload.services.ts` | extract `parseKey(raw)` (strip public base → validate shape → `{purpose,userId,filename}`); rewrite `assertOwnedKey` on top of it; add `signDownloadUrl(key)` (`GetObjectCommand` + 300s) |
| 4.2 | `controllers/upload.controllers.ts` | `getUpload`: 503 if unconfigured, 400 on bad key, else `Cache-Control` + `res.redirect(302, signed)` |
| 4.3 | `routes/upload.routes.ts` | `router.get('/*key', requireAuth, getUpload)` — **Express 5 requires a named wildcard**; bare `'*'` throws at boot |
| 4.4 | `validators/upload.validators.ts` | export `uploadRefSchema` — a key **or** a URL under our public base |
| 4.5 | `validators/camp.validators.ts` | `coverImage: z.string().url()` → `uploadRefSchema` (fixes §1.2) |
| 4.6 | `validators/group.validators.ts` | `updateGroupSchema` gains `photo: uploadRefSchema.nullable().optional()` |
| 4.7 | `services/group.services.ts` | `update` calls `assertOwnedKey(patch.photo, actorId)` — the guardrail every key-accepting write path owes |
| 4.8 | `docs/openapi.ts` | register `GET /uploads/{key}`; refresh the group + camp schemas |

No new route file, no new model field: `User.photo`, `Group.photo`, and
`Camp.coverImage` all already exist. `PATCH /camps/:id/groups/:gid` already exists
and is already `requireCampManager` — group photo needs a *field*, not a route.

---

## 5. Frontend changes

### 5.1 `resolveUploadUrl(ref)` — the one place a stored ref becomes an `src`

New `src/lib/upload/resolveUploadUrl.ts`. Every `<img src>` fed by server data
goes through it:

```
null/''            → null
'data:…'           → as-is   ← legacy base64 already persisted in localStorage
'blob:…'           → as-is   ← in-flight local preview
'http(s)://…'      → as-is   ← already absolute (CDN later, external seeds now)
'/camp-cover.jpg'  → as-is   ← app static asset
'avatar/68a1…/x'   → `${API_BASE}/uploads/avatar/68a1…/x`
```

The `data:` and `/`-prefixed branches are what make this a **non-breaking**
migration: existing users carry base64 photos in persisted Zustand and
`campHome.ts` falls back to `/camp-cover.jpg`. Both keep rendering untouched
while new uploads land as keys.

### 5.2 Camera capture

`<input type="file" accept="image/*" capture="environment">` opens the camera
directly on mobile — but **one input can't be both** gallery and camera, and
`capture` is ignored on desktop. So:

- new `useImagePicker()` hook owns **two** hidden inputs and exposes
  `pickFromGallery()` / `pickFromCamera()`;
- new `PhotoSourceSheet` (built on the existing `Sheet` primitive) offers the
  choice on touch devices — detected with `matchMedia('(pointer: coarse)')`, a
  capability query rather than a user-agent sniff;
- on a mouse device the sheet is skipped entirely and the gallery input opens,
  because a "Camera" row that silently opens a file dialog is a lie.

**Known gap:** iOS may hand back **HEIC** from the gallery. It isn't in
`ACCEPTED_TYPES`, so `validateUpload` rejects it with the translated
`wrongType` copy — correct behavior, mediocre experience. Client-side transcode
to JPEG is a tracked follow-up, not this pass.

### 5.3 Per-surface wiring

| Surface | Change |
|---|---|
| `ImageUploadField` | gains camera support; stays the single pick→validate→presign→PUT→report-key component |
| `ProfileForm` (signup) | drop `FileReader`; `useUpload({purpose:'avatar'})`; store the **key**; render via `resolveUploadUrl` |
| `IdentityCard` (profile) | same, **plus** it must persist — today it only writes to Zustand. Calls `useCompleteProfile` with the existing name/surname/city and the new key |
| `GroupPhotoButton` | `onPick` keeps taking a `File` (the parent owns the upload — it knows the campId/groupId), gains the source sheet |
| `ChatScreen` (participant) | **photo tile becomes read-only** — see §6 |
| `OrgChatScreen` | coordinator/manager path uploads, then `PATCH /camps/:id/groups/:gid { photo: key }` |
| `useGroupStore` | **deleted.** Group photo is server data now; mirroring it in Zustand is exactly the two-sources-of-truth drift `frontend/CLAUDE.md` forbids. Readers move to the group query |
| `InfoStep.BannerUploader` | **deleted**, replaced by `ImageUploadField` — it is a duplicate of the same 5:2 tile with the same change/remove pills |
| `useCampDraftStore` | `CampDraftInfo` gains `coverImage: string \| null`, so the cover survives a refresh like every other wizard field, and reaches the commit payload |

---

## 6. Hierarchy call: participants no longer set the group photo

Today every participant sees a `+` badge on the chat-header group tile. The write
route behind it (`PATCH /camps/:id/groups/:gid`) is `requireCampManager` — so the
honest options were *widen the route* or *drop the button*.

Dropping it. A group photo is **group identity**; letting any of ~10 participants
overwrite it for everyone is a griefing surface, and `OrgChatScreen` already gated
the same tile on `isCoordinator`. Participants get the read-only tile
(`GroupPhotoButton` without `onPick` — already supported). Coordinators and
managers keep the uploader.

This resolves an existing UI-vs-server mismatch: the button never worked against
a real backend anyway. Root `CLAUDE.md`: *a hidden button is not a permission* —
here the permission was always the server's, and the UI was the thing lying.

---

## 7. i18n

New keys under `t.upload`, EN/UZ/RU (the typed translations table fails `tsc` if a
language is missing one):

| key | EN |
|---|---|
| `sourceTitle` | Add a photo |
| `fromGallery` | Choose from gallery |
| `fromCamera` | Take a photo |

---

## 8. Migrating to CloudFront later

Everything above is CDN-ready by construction. When a distribution exists:

1. set `S3_PUBLIC_BASE_URL` to the CloudFront origin;
2. `presign` already returns `${base}/${key}` as `publicUrl`;
3. `parseKey` already strips that base, so `assertOwnedKey` and `uploadRefSchema`
   keep accepting both forms;
4. `resolveUploadUrl` already passes absolute URLs straight through.

The `/uploads/*key` route stays as the private-object path. No UI change.

---

## 9. Follow-ups (explicitly not now)

- **Chat attachments** — the composer `+`. `AttachmentMenu` exists but is rendered
  by nobody and `Composer` has no `+` button. Needs a `Message` attachment field,
  a `chat:send` contract change, a `chat` upload purpose, a non-image MIME
  allowlist, bubble rendering, and offline-outbox handling for pending uploads.
- **HEIC transcode** on the client (§5.2).
- **Orphan cleanup** — a presigned-then-abandoned object is never referenced and
  never deleted. Needs an S3 lifecycle rule or a sweeper.
- **Per-object authz** (§2.2).
- **Server-side resize/thumbnails** — a 5 MB avatar is served at 5 MB.
