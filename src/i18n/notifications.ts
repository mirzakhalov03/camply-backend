type Lang = 'uz' | 'ru' | 'en'

// The SMALL server-side copy map — only strings the server sends as push. UI copy
// stays in the frontend. {sender}/{text} are substituted per language.
const NEW_MESSAGE: Record<Lang, { groupTitle: string; orgTitle: string; body: string }> = {
  uz: { groupTitle: 'Yangi xabar', orgTitle: 'Tashkilotchilar chati', body: '{sender}: {text}' },
  ru: { groupTitle: 'Новое сообщение', orgTitle: 'Чат организаторов', body: '{sender}: {text}' },
  en: { groupTitle: 'New message', orgTitle: 'Organizers chat', body: '{sender}: {text}' },
}

export function newMessagePush(
  lang: Lang,
  channel: 'group' | 'organizers',
  sender: string,
  text: string,
): { title: string; body: string } {
  const c = NEW_MESSAGE[lang] ?? NEW_MESSAGE.uz
  const snippet = text.length > 80 ? text.slice(0, 79) + '…' : text
  return {
    title: channel === 'organizers' ? c.orgTitle : c.groupTitle,
    body: c.body.replace('{sender}', sender).replace('{text}', snippet),
  }
}
