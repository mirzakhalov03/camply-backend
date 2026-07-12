// Display-only identity helpers. No stored fields: initials come from the name,
// the tile color is a deterministic pick so a person keeps one color.
const PALETTE = ['pine', 'amber', 'sky', 'deep']

export const initialsOf = (name: string): string =>
  name
    .split(' ')
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')

export const colorFor = (seed: string): string =>
  PALETTE[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]
