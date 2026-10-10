/** The shortcut modifier this device's keyboard labels: ⌘ on Apple, Ctrl elsewhere. */
export const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
