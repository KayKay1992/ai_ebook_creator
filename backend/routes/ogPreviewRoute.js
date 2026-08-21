const express = require("express");
const router = express.Router();
const Book = require("../models/Book");
const Bundle = require("../models/Bundle");

// Link-preview crawlers for the major social/messaging platforms. These all
// fetch a shared URL's raw HTML and parse it with a static parser — none of
// them execute JavaScript, which is exactly why the client-side
// useOpenGraphTags hook (frontend/src/hooks) can never reach them: a plain
// curl against the SPA confirmed they only ever see index.html's generic
// tags. Anything not on this list is treated as a real visitor.
const CRAWLER_UA_PATTERNS = [
  /facebookexternalhit/i, // Facebook / Instagram
  /facebot/i, // Facebook's newer crawler
  /twitterbot/i, // Twitter/X
  /whatsapp/i, // WhatsApp
  /linkedinbot/i, // LinkedIn
  /slackbot/i, // Slack (incl. Slackbot-LinkExpanding)
  /telegrambot/i, // Telegram
  /discordbot/i, // Discord
  /skypeuripreview/i, // Skype
  /redditbot/i, // Reddit
  /pinterest/i, // Pinterest
  /vkshare/i, // VKontakte
  /viber/i, // Viber
];

const isCrawlerUA = (ua = "") => CRAWLER_UA_PATTERNS.some((re) => re.test(ua));

// Where the real SPA lives — same env var server.js already uses for CORS.
// This route is deliberately NOT the page a human ends up reading; it only
// exists to hand crawlers something static to parse, then bounce everyone
// else (including the crawler itself, via meta refresh) to the real page.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// og:image must be an absolute URL. Cloudinary secure_urls always are, but
// a pre-migration local /uploads/... path (no longer served, see CLAUDE.md)
// isn't — drop it rather than emit a tag that resolves to nothing.
const asAbsoluteImage = (url) => (url && /^https?:\/\//i.test(url) ? url : null);

const renderCrawlerHtml = ({ title, description, image, redirectTo }) => {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    description
      ? `<meta property="og:description" content="${escapeHtml(description)}" />`
      : "",
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
    image
      ? `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />`
      : "",
    `<meta property="og:url" content="${escapeHtml(redirectTo)}" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    ${tags}
    <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectTo)}" />
    <link rel="canonical" href="${escapeHtml(redirectTo)}" />
  </head>
  <body>
    <p>Redirecting to <a href="${escapeHtml(redirectTo)}">${escapeHtml(title)}</a>…</p>
  </body>
</html>`;
};

const renderRedirectOnlyHtml = (redirectTo) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Kenlibs</title>
    <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectTo)}" />
  </head>
  <body>
    <p>Redirecting…</p>
  </body>
</html>`;

router.get("/kenlibs/book/:id", async (req, res) => {
  const spaUrl = `${FRONTEND_URL}/kenlibs/book/${req.params.id}`;

  // Real visitors should never organically land on this backend route (the
  // shared link points at the frontend origin) — but if one does, bounce
  // them straight to the working SPA instead of showing them bot-facing HTML.
  if (!isCrawlerUA(req.headers["user-agent"])) {
    return res.redirect(302, spaUrl);
  }

  try {
    const book = await Book.findOne({
      _id: req.params.id,
      status: "published",
    }).select("title subtitle author coverImage coverDesign");

    if (!book) {
      return res.status(404).send(renderRedirectOnlyHtml(spaUrl));
    }

    const image =
      asAbsoluteImage(book.coverImage) ||
      asAbsoluteImage(book.coverDesign?.front?.backgroundImage);
    const blurb = book.coverDesign?.back?.blurb?.trim();

    res.set("Cache-Control", "public, max-age=600");
    res.send(
      renderCrawlerHtml({
        title: `${book.title} — Kenlibs`,
        description:
          blurb || `by ${book.author || "Unknown Author"} — read it on Kenlibs.`,
        image,
        redirectTo: spaUrl,
      })
    );
  } catch (error) {
    res.status(500).send(renderRedirectOnlyHtml(spaUrl));
  }
});

router.get("/kenlibs/bundle/:id", async (req, res) => {
  const spaUrl = `${FRONTEND_URL}/kenlibs/bundle/${req.params.id}`;

  if (!isCrawlerUA(req.headers["user-agent"])) {
    return res.redirect(302, spaUrl);
  }

  try {
    const bundle = await Bundle.findOne({
      _id: req.params.id,
      isForSale: true,
    })
      .select("title description coverImage")
      .populate({
        path: "books",
        select: "coverImage coverDesign",
        match: { status: "published" },
      });

    if (!bundle) {
      return res.status(404).send(renderRedirectOnlyHtml(spaUrl));
    }

    const fallbackBook = bundle.books?.[0];
    const image =
      asAbsoluteImage(bundle.coverImage) ||
      asAbsoluteImage(fallbackBook?.coverDesign?.front?.backgroundImage) ||
      asAbsoluteImage(fallbackBook?.coverImage);
    const bookCount = bundle.books?.length || 0;

    res.set("Cache-Control", "public, max-age=600");
    res.send(
      renderCrawlerHtml({
        title: `${bundle.title} — Kenlibs`,
        description:
          bundle.description?.trim() ||
          `A bundle of ${bookCount} book${bookCount === 1 ? "" : "s"} on Kenlibs.`,
        image,
        redirectTo: spaUrl,
      })
    );
  } catch (error) {
    res.status(500).send(renderRedirectOnlyHtml(spaUrl));
  }
});

module.exports = router;
