process.env.TZ = 'UTC'; // chat day boundaries use local time
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';

// findBy* and waitFor give up after 1 s by default. A first render in a whole-suite run on a busy machine can take
// that long (FeedOnboarding measured 931-997 ms), so a late render must not fail a test.
configure({ asyncUtilTimeout: 3000 });

// Motion: finish every animation instantly so exit transitions don't keep removed elements in the DOM.
MotionGlobalConfig.skipAnimations = true;
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); }); // drafts persist in localStorage
// jsdom lacks <dialog> modal APIs
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
