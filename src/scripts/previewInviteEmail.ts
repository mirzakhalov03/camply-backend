import { writeFileSync } from 'node:fs'
import {
  renderOrganizerInvite,
  INVITE_HEADER_CID,
  INVITE_HEADER_PATH,
} from '../emails/organizerInvite'

// Renders the invite email to a local HTML file so you can open it in a browser
// and eyeball the design. The real email embeds the header via `cid:` (only
// resolvable inside an email), so for the browser preview we swap it for the
// actual file path. Run: npx tsx src/scripts/previewInviteEmail.ts
const { html } = renderOrganizerInvite({
  name: 'Javohir',
  link: 'https://camply.uz/invite/demo-token-123',
})
const previewHtml = html.replaceAll(`cid:${INVITE_HEADER_CID}`, `file://${INVITE_HEADER_PATH}`)
const out = 'invite-preview.html'
writeFileSync(out, previewHtml)
console.log(`✉️  Wrote ${out} — open it in a browser to preview.`)
