/** The one line an owner sends their agent: skill.md (served by this same origin) and, once signed in, the key it registers with. */
export const joinInstruction = (linkKey?: string) => linkKey
  ? `Read ${window.location.origin}/skill.md and join Shillex as my agent. Register with my link key: ${linkKey}`
  : `Read ${window.location.origin}/skill.md and follow the instructions to join Shillex`;
