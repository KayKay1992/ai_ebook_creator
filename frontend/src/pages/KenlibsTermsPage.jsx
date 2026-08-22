import { Link } from "react-router-dom";
import KenlibsPolicyLayout from "../components/kenlibs/KenlibsPolicyLayout";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_HREF } from "../components/kenlibs/KenlibsFooter";

const KenlibsTermsPage = () => (
  <KenlibsPolicyLayout title="Terms of Service" lastUpdated="August 22, 2026">
    <section>
      <p>
        These Terms of Service ("Terms") govern your use of Kenlibs, the
        online bookstore and reading platform operated by Kenneth Nwankpa
        ("Kenlibs," "we," "us"). By creating an account, browsing, purchasing,
        or reading on Kenlibs, you agree to these Terms. If you don't agree,
        please don't use Kenlibs.
      </p>
    </section>

    <section>
      <h2>1. Your Account</h2>
      <p>
        You need an account to purchase or read books on Kenlibs. You agree
        to:
      </p>
      <ul>
        <li>Provide accurate name and email information when you register.</li>
        <li>
          Keep your password secure and confidential. You're responsible for
          any activity that happens under your account.
        </li>
        <li>
          Use one account per person. Accounts aren't meant to be shared
          between multiple readers.
        </li>
        <li>
          Let us know right away, at the contact details below, if you
          believe your account has been accessed without your permission.
        </li>
      </ul>
    </section>

    <section>
      <h2>2. What Kenlibs Sells: Reading Access, Not Files or Ownership</h2>
      <p>
        When you purchase a book or bundle on Kenlibs, you are buying{" "}
        <strong>personal, non-transferable access to read that title</strong>{" "}
        through the Kenlibs reader in your browser. You are not purchasing:
      </p>
      <ul>
        <li>
          A downloadable copy, file, or any other reproduction of the book
          you could store, print, or transfer outside Kenlibs.
        </li>
        <li>Ownership of the book, its text, or any part of its content.</li>
        <li>
          Any right to copy, redistribute, resell, publicly share, or make
          the book available to anyone else — including friends, family, or
          the general public — in any form.
        </li>
      </ul>
      <p>
        All book content, cover art, and related materials on Kenlibs remain
        the property of Kenneth Nwankpa unless stated otherwise. Sharing your
        account or your access to a purchased book with someone who hasn't
        purchased it themselves is a violation of these Terms and may result
        in your access being revoked without a refund.
      </p>
    </section>

    <section>
      <h2>3. How Purchases Work</h2>
      <p>
        Kenlibs does not currently use an automated payment gateway.
        Instead, purchases are verified manually:
      </p>
      <ul>
        <li>
          You submit a "Request to Buy" for a book or bundle, make a bank
          transfer for the listed price using the payment instructions shown
          at checkout, and upload a screenshot or photo as evidence of that
          payment.
        </li>
        <li>
          We review the evidence you submit and either approve it (granting
          you reading access) or reject it (for example, if the evidence is
          unclear, doesn't match the amount, or can't be verified).
        </li>
        <li>
          If your evidence is rejected, you can resubmit new evidence for the
          same request — see our{" "}
          <Link to="/kenlibs/refund-policy">Refund Policy</Link> for details.
        </li>
        <li>
          Because this review is manual, approval isn't instant — please
          allow reasonable time for us to review your submission.
        </li>
      </ul>
    </section>

    <section>
      <h2>4. Content Provided "As Is"</h2>
      <p>
        Books and bundles on Kenlibs are provided "as is" and "as available."
        We don't guarantee that content will be error-free, uninterrupted, or
        that it will meet every expectation. While we take reasonable care in
        publishing accurate, well-written material, we don't warrant the
        completeness, accuracy, or suitability of any book for a particular
        purpose. Reading platform availability (e.g. during maintenance or
        unexpected downtime) also isn't guaranteed.
      </p>
    </section>

    <section>
      <h2>5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          Copy, scrape, screen-record, redistribute, or extract book content
          from Kenlibs for any purpose beyond your own personal reading.
        </li>
        <li>
          Attempt to circumvent, disable, or interfere with the access
          controls that gate reading to approved purchasers.
        </li>
        <li>
          Use another person's account, or let someone else use yours, to
          access content they haven't purchased.
        </li>
        <li>
          Submit falsified, altered, or misleading payment evidence.
        </li>
      </ul>
      <p>
        We reserve the right to revoke a reader's access to a book or bundle,
        or suspend an account entirely, if we reasonably believe these Terms
        have been violated.
      </p>
    </section>

    <section>
      <h2>6. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time as Kenlibs evolves — for
        example, as new features are added or our payment process changes.
        We'll update the "Last updated" date above when we do. Continuing to
        use Kenlibs after a change means you accept the updated Terms.
      </p>
    </section>

    <section>
      <h2>7. Contact & Disputes</h2>
      <p>
        Questions about these Terms, a purchase, or your account? Reach us
        at:
      </p>
      <ul>
        <li>
          Email:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </li>
        <li>
          WhatsApp:{" "}
          <a href={SUPPORT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
            {SUPPORT_WHATSAPP_DISPLAY}
          </a>
        </li>
      </ul>
      <p>
        We'll do our best to resolve any dispute directly and in good faith
        before either party considers any other course of action.
      </p>
    </section>
  </KenlibsPolicyLayout>
);

export default KenlibsTermsPage;
