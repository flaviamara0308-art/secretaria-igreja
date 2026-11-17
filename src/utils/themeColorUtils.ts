import type React from 'react';
import type { Church } from '../types';

export const DEFAULT_CHURCH_PRIMARY = '#1e3a8a';
export const DEFAULT_CHURCH_SECONDARY = '#3b82f6';

export function normalizeHexColor(hex?: string, fallback = DEFAULT_CHURCH_PRIMARY): string {
  if (!hex || typeof hex !== 'string') return fallback;
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map(ch => ch + ch)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return fallback;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex);
  const num = parseInt(normalized.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function darkenHex(hex: string, amount = 0.16): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = Math.max(0, 1 - amount);
  return rgbToHex(r * factor, g * factor, b * factor);
}

export function mixWithWhite(hex: string, whiteRatio = 0.88): string {
  const { r, g, b } = hexToRgb(hex);
  const w = Math.max(0, Math.min(1, whiteRatio));
  return rgbToHex(
    r * (1 - w) + 255 * w,
    g * (1 - w) + 255 * w,
    b * (1 - w) + 255 * w
  );
}

export function lightenOrShiftSecondary(primaryHex: string): string {
  const { r, g, b } = hexToRgb(primaryHex);
  return rgbToHex(
    r + (255 - r) * 0.34,
    g + (255 - g) * 0.34,
    b + (255 - b) * 0.34
  );
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Ensures white foreground text remains legible when used on solid primary brand surfaces.
 */
export function ensureAccessiblePrimary(hex: string): string {
  let candidate = normalizeHexColor(hex);
  for (let i = 0; i < 6; i++) {
    if (getRelativeLuminance(candidate) <= 0.4) {
      return candidate;
    }
    candidate = darkenHex(candidate, 0.18);
  }
  return candidate;
}

interface ColorBucket {
  rSum: number;
  gSum: number;
  bSum: number;
  weightSum: number;
  count: number;
}

/**
 * Pure pixel-buffer analyzer that extracts dominant primary & secondary brand hex colors
 * from raw RGBA image data (browser canvas or unit tests).
 */
export function extractBrandColorsFromImageData(
  data: ArrayLike<number>
): { primaryColor: string; secondaryColor: string } | null {
  if (!data || data.length < 4) return null;

  const chromaticBuckets = new Map<string, ColorBucket>();
  const neutralBuckets = new Map<string, ColorBucket>();

  const step = data.length > 40000 ? 16 : 4;

  for (let i = 0; i + 3 < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;

    // Ignore pure white / near-white backgrounds
    if (min > 236 && max > 242) continue;
    // Ignore near-black noise for chromatic ranking
    if (max < 24 && spread < 12) continue;

    const qr = Math.round(r / 24) * 24;
    const qg = Math.round(g / 24) * 24;
    const qb = Math.round(b / 24) * 24;
    const key = `${qr}-${qg}-${qb}`;

    if (spread >= 24) {
      const weight = 1 + spread / 64;
      const existing = chromaticBuckets.get(key) || {
        rSum: 0,
        gSum: 0,
        bSum: 0,
        weightSum: 0,
        count: 0,
      };
      existing.rSum += r * weight;
      existing.gSum += g * weight;
      existing.bSum += b * weight;
      existing.weightSum += weight;
      existing.count += 1;
      chromaticBuckets.set(key, existing);
    } else if (max >= 25 && min <= 220) {
      const existing = neutralBuckets.get(key) || {
        rSum: 0,
        gSum: 0,
        bSum: 0,
        weightSum: 0,
        count: 0,
      };
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
      existing.weightSum += 1;
      existing.count += 1;
      neutralBuckets.set(key, existing);
    }
  }

  const ranked = Array.from(chromaticBuckets.values()).sort(
    (a, b) => b.weightSum - a.weightSum
  );

  if (ranked.length === 0) {
    const neutralRanked = Array.from(neutralBuckets.values()).sort(
      (a, b) => b.count - a.count
    );
    if (neutralRanked.length === 0) return null;
    const top = neutralRanked[0];
    const primary = ensureAccessiblePrimary(
      rgbToHex(top.rSum / top.weightSum, top.gSum / top.weightSum, top.bSum / top.weightSum)
    );
    return {
      primaryColor: primary,
      secondaryColor: lightenOrShiftSecondary(primary),
    };
  }

  const top = ranked[0];
  const rawPrimary = rgbToHex(
    top.rSum / top.weightSum,
    top.gSum / top.weightSum,
    top.bSum / top.weightSum
  );
  const primaryRgb = hexToRgb(rawPrimary);
  const primaryColor = ensureAccessiblePrimary(rawPrimary);

  let secondaryColor = '';
  for (let i = 1; i < ranked.length; i++) {
    const candidate = ranked[i];
    const cr = candidate.rSum / candidate.weightSum;
    const cg = candidate.gSum / candidate.weightSum;
    const cb = candidate.bSum / candidate.weightSum;
    const dist = Math.hypot(cr - primaryRgb.r, cg - primaryRgb.g, cb - primaryRgb.b);
    if (dist >= 65) {
      secondaryColor = rgbToHex(cr, cg, cb);
      break;
    }
  }

  if (!secondaryColor) {
    secondaryColor =
      getRelativeLuminance(rawPrimary) > 0.42
        ? rawPrimary
        : lightenOrShiftSecondary(primaryColor);
  }

  return {
    primaryColor,
    secondaryColor: normalizeHexColor(secondaryColor, DEFAULT_CHURCH_SECONDARY),
  };
}

/**
 * Loads an image data URL / URL into an offscreen HTML5 canvas and extracts dominant colors.
 */
export async function extractBrandColorsFromDataUrl(
  imageSrc: string
): Promise<{ primaryColor: string; secondaryColor: string } | null> {
  if (!imageSrc || typeof document === 'undefined') return null;

  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 96;
        const scale = Math.min(size / (img.width || size), size / (img.height || size), 1);
        const w = Math.max(1, Math.round((img.width || size) * scale));
        const h = Math.max(1, Math.round((img.height || size) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        resolve(extractBrandColorsFromImageData(imageData.data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageSrc;
  });
}

export interface ChurchThemePalette {
  primary: string;
  primaryHover: string;
  secondary: string;
  softBg: string;
  softBorder: string;
  primaryRgb: string;
  secondaryRgb: string;
}

export function getChurchThemePalette(
  church?: Church | null,
  isPlatformStaff = false
): ChurchThemePalette {
  if (isPlatformStaff) {
    const p = '#0f172a';
    const s = '#4f46e5';
    const pRgb = hexToRgb(p);
    const sRgb = hexToRgb(s);
    return {
      primary: p,
      primaryHover: '#1e293b',
      secondary: s,
      softBg: '#eef2ff',
      softBorder: '#c7d2fe',
      primaryRgb: `${pRgb.r}, ${pRgb.g}, ${pRgb.b}`,
      secondaryRgb: `${sRgb.r}, ${sRgb.g}, ${sRgb.b}`,
    };
  }

  const primary = ensureAccessiblePrimary(
    normalizeHexColor(church?.primaryColor, DEFAULT_CHURCH_PRIMARY)
  );
  const secondary = normalizeHexColor(
    church?.secondaryColor,
    DEFAULT_CHURCH_SECONDARY
  );
  const pRgb = hexToRgb(primary);
  const sRgb = hexToRgb(secondary);

  return {
    primary,
    primaryHover: darkenHex(primary, 0.14),
    secondary,
    softBg: mixWithWhite(primary, 0.91),
    softBorder: mixWithWhite(primary, 0.72),
    primaryRgb: `${pRgb.r}, ${pRgb.g}, ${pRgb.b}`,
    secondaryRgb: `${sRgb.r}, ${sRgb.g}, ${sRgb.b}`,
  };
}

export function buildChurchThemeVars(
  church?: Church | null,
  isPlatformStaff = false
): React.CSSProperties {
  const palette = getChurchThemePalette(church, isPlatformStaff);
  return {
    '--church-primary': palette.primary,
    '--church-primary-hover': palette.primaryHover,
    '--church-secondary': palette.secondary,
    '--church-soft-bg': palette.softBg,
    '--church-soft-border': palette.softBorder,
    '--church-primary-rgb': palette.primaryRgb,
    '--church-secondary-rgb': palette.secondaryRgb,
  } as React.CSSProperties;
}
