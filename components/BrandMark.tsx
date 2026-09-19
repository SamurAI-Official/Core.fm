import React from 'react';

/**
 * Core.fm brand mark — the single source of truth for the product logo.
 *
 * Used by the sidebar (top left) and the login modal so the two can never drift
 * apart.
 *
 * PREFERS THE SUPPLIED RASTER: if `public/brand/corefm-logo.png` exists it is used
 * directly, because that file IS the reference artwork. The inline SVG below is a
 * hand-authored *approximation* of it (samurai bust inside a bladed ring) used only
 * as a fallback when the raster is absent — it is not a trace of the original, and
 * two attempts at a faithful silhouette still read as a helmeted blob rather than
 * the reference's samurai.
 *
 * The raster is inverted in dark mode (`dark:invert`): the artwork is black on a
 * white background, so on a dark sidebar it would otherwise be a black shape on a
 * white square. Inverting gives white-on-black, which is what the dark theme needs;
 * in light mode the white background blends into the white sidebar.
 *
 * The inline SVG path stays monochrome + `currentColor` so it themes without a
 * second asset, and is deliberately simplified because the top-left slot renders at
 * 40px where fine detail is lost regardless.
 */

interface BrandMarkProps {
  /** Tailwind sizing/colour classes, e.g. `w-10 h-10 text-zinc-900 dark:text-white`. */
  className?: string;
  title?: string;
  onClick?: () => void;
}

/** Path to the supplied artwork. Drop the reference image here to activate it. */
export const BRAND_RASTER_SRC = '/brand/corefm-logo.png';

/**
 * Outer edge of each blade sits at r=200 so it nearly meets the ring's inner
 * edge (r=217), matching the reference's tight ring/blade spacing.
 */
const BLADE_PATH = 'M196 56 L316 56 L292 168 Q256 150 220 168 Z';

/** Five blades at 72° spacing: top, upper-right, lower-right, lower-left, upper-left. */
const BLADE_ANGLES = [0, 72, 144, 216, 288];

/**
 * Samurai bust — drawn as a single readable *silhouette*, which is how the
 * reference works too. The first attempt failed here: a straight-topped rounded
 * rectangle for the torso read as a loaf, and a small detached crest read as
 * moustache horns. So the torso now has sloped shoulders and a neck stub, and the
 * crest is a single swept horn rising well clear of the helmet.
 */
const SAMURAI_PATHS = [
  // Crest, swept up and back from the front of the helmet
  'M244 236 C230 214 222 192 226 172 C240 192 254 212 266 230 Z',
  // Kabuto (helmet dome) — deliberately wider than the neck below it
  'M214 278 C214 222 298 222 298 278 Z',
  // Torso: up the sides, sloping shoulders, neck stub, then down again
  'M178 386 L178 332 C178 306 200 290 228 286 L228 276 L286 276 L286 286 C314 290 336 306 336 332 L336 386 Z',
];

/**
 * Staff carried diagonally across the body (lower-left to upper-right). Offset to
 * the right and shortened so it clears the helmet — previously it ran straight
 * through the head, which made it read as a spear impaling the figure.
 */
const SHAFT = { x: 292, y: 208, width: 13, height: 182, rx: 6 };
const SHAFT_HEAD = { x: 286, y: 352, width: 25, height: 64, rx: 4 };
const SHAFT_ROTATION = 'rotate(30 256 300)';

export const BrandMark: React.FC<BrandMarkProps> = ({ className, title, onClick }) => {
  // Each instance needs its own mask id: two marks can be mounted at once
  // (sidebar + login modal) and duplicate DOM ids would be invalid.
  const maskId = React.useMemo(() => `corefm-mark-${Math.random().toString(36).slice(2, 8)}`, []);

  // Hooks must run before any early return, hence state is declared here.
  const [rasterFailed, setRasterFailed] = React.useState(false);

  // Prefer the supplied artwork. The button below is a fallback, not the logo.
  if (!rasterFailed) {
    return (
      <img
        src={BRAND_RASTER_SRC}
        alt={title || 'Core.fm'}
        title={title}
        onClick={onClick}
        className={`${className || ''} object-contain dark:invert`}
        onError={() => {
          setRasterFailed(true);
        }}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      onClick={onClick}
      role="img"
      aria-label={title || 'Core.fm'}
    >
      <defs>
        {/*
          The mask punches the figure out of the blades with a 26px stroke, so the
          gap around the samurai and staff shows the real page background through
          it. That is what keeps the mark readable on both themes without a second
          asset. Mask internals stay literal black/white — never themed.
        */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <rect width="512" height="512" fill="#fff" />
          <g fill="#000" stroke="#000" strokeWidth="26" strokeLinejoin="round">
            {SAMURAI_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
            <rect {...SHAFT} transform={SHAFT_ROTATION} />
          </g>
        </mask>
      </defs>

      {/* Outer ring */}
      <circle cx="256" cy="256" r="230" stroke="currentColor" strokeWidth="26" />

      {/* Bladed ring, punched out around the figure by the mask */}
      <g mask={`url(#${maskId})`} fill="currentColor">
        {BLADE_ANGLES.map((angle) => (
          <path key={angle} d={BLADE_PATH} transform={`rotate(${angle} 256 256)`} />
        ))}
      </g>

      {/* Figure sits inside the punched-out gap */}
      <g fill="currentColor">
        {SAMURAI_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
        <rect {...SHAFT} rx={SHAFT.rx} transform={SHAFT_ROTATION} />
        <rect {...SHAFT_HEAD} transform={SHAFT_ROTATION} />
      </g>
    </svg>
  );
};

export default BrandMark;
