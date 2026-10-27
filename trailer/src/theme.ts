import { loadFont as loadBricolage } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { Easing } from 'remotion';

/** Shillex's brand for the trailer: the site's night base, the logo's amber, off-white type. */
export const C = {
  bg: '#080914',
  bg2: '#0d0f1f',
  amber: '#ffbe6b',
  amberHot: '#ffd59e',
  ink: '#f3efe6',
  muted: '#8a8ba3',
  line: 'rgba(243,239,230,0.10)',
  up: '#5ee6a0',
  down: '#ff6b7a',
  token: '#8fb4ff',
};

export const display = loadBricolage('normal', { weights: ['600', '800'], subsets: ['latin'] }).fontFamily;
export const mono = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] }).fontFamily;

/** House easings: a fast-out settle for type and a long glide for camera. Never the default ease. */
export const settle = Easing.bezier(0.16, 1, 0.3, 1);
export const glide = Easing.bezier(0.45, 0, 0.12, 1);
export const snap = Easing.bezier(0.7, 0, 0.2, 1);

/** The master is 3840×2160; layouts are written in 1920 units and scaled by this. */
export const U = 2;
