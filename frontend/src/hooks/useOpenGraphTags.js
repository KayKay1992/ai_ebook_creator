import { useEffect } from "react";

// Upserts a single `<meta property="...">` tag and returns enough state to
// restore it on cleanup — mirrors useDocumentTitle's restore-on-unmount
// pattern so leaving a detail page puts index.html's static defaults back
// rather than leaking one book's tags onto the next page visited.
const setMetaTag = (property, content) => {
  if (!content) return null;
  let el = document.querySelector(`meta[property="${property}"]`);
  const existed = !!el;
  const previousContent = el?.getAttribute("content") ?? null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
  return { property, existed, previousContent };
};

// KNOWN LIMITATION — read before relying on this for link previews:
// This only ever touches the DOM after React has mounted, so it helps real
// browsers (tab title, and anything that inspects the live DOM) but does
// NOT help link-preview crawlers. WhatsApp, Twitter/X, Facebook, LinkedIn,
// Slack, Discord, Telegram, etc. all fetch the bare HTML response for a
// shared URL and parse it with a static HTML parser — none of them execute
// JavaScript, so they only ever see index.html's static generic <meta
// property="og:..."> tags, never the per-book/per-bundle values this hook
// sets. Fixing that for real requires server-side rendering (or at minimum
// a bot-detected pre-rendered HTML response) for these routes — see this
// project's handoff notes for what that would take. Ship this as a
// best-effort/browser-tab improvement, not as the actual unfurl fix.
const useOpenGraphTags = ({ title, description, image, url, type = "website" }) => {
  useEffect(() => {
    if (!title) return;

    const previousTitle = document.title;
    document.title = title;

    const restores = [
      setMetaTag("og:title", title),
      setMetaTag("og:description", description),
      setMetaTag("og:image", image),
      setMetaTag("og:url", url || window.location.href),
      setMetaTag("og:type", type),
    ].filter(Boolean);

    return () => {
      document.title = previousTitle;
      restores.forEach(({ property, existed, previousContent }) => {
        const el = document.querySelector(`meta[property="${property}"]`);
        if (!el) return;
        if (existed && previousContent !== null) {
          el.setAttribute("content", previousContent);
        } else if (!existed) {
          el.remove();
        }
      });
    };
  }, [title, description, image, url, type]);
};

export default useOpenGraphTags;
