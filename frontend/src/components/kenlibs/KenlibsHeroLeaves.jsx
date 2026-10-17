// Soft plant leaves for the storefront hero's right side (KenlibsPage).
// A small inline SVG (no image request, nothing to lazy-load) with
// gradient-filled leaves at low opacity, so they read as out-of-focus
// foliage behind the text, like the brand flier. Purely decorative.
const LEAF = "M0 0C14-17 46-21 72-7C50 11 20 15 0 0Z";

// [x, y, rotation, scale, gradient, opacity]
const LEAVES = [
  [118, 70, -38, 1.25, "a", 0.9],
  [150, 118, -12, 1.4, "b", 0.85],
  [104, 158, -58, 1.15, "a", 0.75],
  [168, 196, 8, 1.3, "b", 0.8],
  [96, 236, -70, 1.05, "a", 0.7],
  [176, 276, 22, 1.2, "a", 0.65],
  [126, 300, -30, 1.1, "b", 0.6],
  [210, 92, -100, 1.05, "b", 0.55],
  [222, 170, -125, 1.15, "a", 0.5],
];

const KenlibsHeroLeaves = ({ className = "" }) => (
  <svg viewBox="0 0 280 360" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMid slice">
    <defs>
      <linearGradient id="kenlibs-leaf-a" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--color-forest-leaf-light)" />
        <stop offset="1" stopColor="var(--color-forest-leaf)" />
      </linearGradient>
      <linearGradient id="kenlibs-leaf-b" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="var(--color-forest-leaf)" />
        <stop offset="1" stopColor="#4f8a3a" />
      </linearGradient>
    </defs>
    {/* Stems */}
    <g fill="none" stroke="var(--color-forest-leaf)" strokeWidth="3" strokeLinecap="round" opacity="0.8">
      <path d="M150 360C146 290 128 220 120 70" />
      <path d="M150 360C168 300 190 230 214 94" />
    </g>
    {LEAVES.map(([x, y, r, s, g, o], i) => (
      <g key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} opacity={o}>
        <path d={LEAF} fill={`url(#kenlibs-leaf-${g})`} />
        <path d="M2 0C24-3 46-4 68-6" fill="none" stroke="#0b2a12" strokeOpacity="0.35" strokeWidth="1.2" />
      </g>
    ))}
  </svg>
);

export default KenlibsHeroLeaves;
