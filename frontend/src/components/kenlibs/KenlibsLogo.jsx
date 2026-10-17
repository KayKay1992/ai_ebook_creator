// The Kenlibs mark: brand-orange rounded square with a white line-drawn
// open book (as in the brand flier, design-ref/). Inline SVG: crisp at any
// size, no request. Decorative by default (the wordmark next to it carries
// the name); pass `title` when it stands alone.
const KenlibsLogo = ({ className = "w-9 h-9", title }) => (
  <svg
    viewBox="0 0 40 40"
    className={className}
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    {title && <title>{title}</title>}
    <rect width="40" height="40" rx="10" fill="var(--color-accent)" />
    <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {/* Left and right pages meeting at the spine, gently curved. */}
      <path d="M20 13.5c-2.6-1.9-5.9-2.6-9.5-2.4v15.6c3.6-.2 6.9.5 9.5 2.4" />
      <path d="M20 13.5c2.6-1.9 5.9-2.6 9.5-2.4v15.6c-3.6-.2-6.9.5-9.5 2.4" />
      <path d="M20 13.5v15.6" />
    </g>
  </svg>
);

export default KenlibsLogo;
