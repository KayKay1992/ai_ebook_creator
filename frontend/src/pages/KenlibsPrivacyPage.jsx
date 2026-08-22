import KenlibsPolicyLayout from "../components/kenlibs/KenlibsPolicyLayout";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_HREF } from "../components/kenlibs/KenlibsFooter";

const KenlibsPrivacyPage = () => (
  <KenlibsPolicyLayout title="Privacy Policy" lastUpdated="August 22, 2026">
    <section>
      <p>
        This Privacy Policy explains what information Kenlibs (operated by
        Kenneth Nwankpa) collects when you use the platform, how it's used,
        and who else — if anyone — has access to it.
      </p>
    </section>

    <section>
      <h2>1. Information We Collect</h2>
      <p>We collect the following information directly from you:</p>
      <ul>
        <li>
          <strong>Account information:</strong> your name and email address
          when you register, and a securely hashed version of your password
          (we never store your password in plain, readable text).
        </li>
        <li>
          <strong>Payment evidence images:</strong> the screenshot or photo
          you upload as proof of a bank transfer when requesting to buy a
          book or bundle.
        </li>
        <li>
          <strong>Reading activity:</strong> which chapter you're on, your
          personal notes (if you use the notepad feature), your Listen Mode
          position, and whether you've completed a book — so you can pick up
          where you left off and, once you finish a book, download a
          completion certificate.
        </li>
        <li>
          <strong>A login session token:</strong> stored in your browser
          (via local storage) after you sign in, so you stay logged in
          between visits. This isn't used for advertising or tracking across
          other websites.
        </li>
      </ul>
      <p>
        We don't currently run analytics, advertising trackers, or
        marketing cookies on Kenlibs.
      </p>
    </section>

    <section>
      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To create and manage your account, and let you sign in.</li>
        <li>
          To review and verify your payment evidence and grant you reading
          access once a purchase is approved.
        </li>
        <li>
          To save your reading progress and notes so they're there the next
          time you open a book.
        </li>
        <li>To respond to support requests and resolve disputes.</li>
        <li>
          To generate your completion certificate (which includes your
          account name) when you finish a book.
        </li>
      </ul>
    </section>

    <section>
      <h2>3. Payment Evidence — Used Only to Verify Your Purchase</h2>
      <p>
        The payment evidence image you upload is used for one purpose only:
        confirming that your payment was made before we grant you access to
        a book or bundle. It's visible to our admin team during that review,
        kept on file as a record in case a payment is later disputed, and is{" "}
        <strong>not shared with any third party, publicly displayed, or
        used for any purpose beyond purchase verification.</strong>
      </p>
    </section>

    <section>
      <h2>4. Third-Party Service Providers</h2>
      <p>
        We use a small number of outside services to run Kenlibs. The one
        that handles data you provide directly is:
      </p>
      <ul>
        <li>
          <strong>Cloudinary</strong> — an image hosting and delivery
          service. Book covers, chapter images, author photos, and your
          uploaded payment evidence images are stored with Cloudinary on our
          behalf. Cloudinary processes these images only to host and serve
          them for Kenlibs — it does not have an independent relationship
          with you as a reader.
        </li>
      </ul>
      <p>
        Beyond image hosting, Kenlibs also relies on general-purpose hosting
        and database infrastructure to run the application and store your
        account/reading data securely.
      </p>
    </section>

    <section>
      <h2>5. How Long We Keep Your Information</h2>
      <p>
        We keep your account and reading data for as long as your account is
        active. Payment evidence images are retained as a record of past
        transactions, primarily to resolve any future disputes about a
        purchase. If you'd like your account or data deleted, contact us
        using the details below and we'll act on that request.
      </p>
    </section>

    <section>
      <h2>6. Your Choices</h2>
      <p>You can, at any time, contact us to:</p>
      <ul>
        <li>Ask what personal information we hold about you.</li>
        <li>Request a correction to inaccurate information.</li>
        <li>
          Request that your account and associated data be deleted (note:
          this would also end your reading access to any purchased books).
        </li>
      </ul>
    </section>

    <section>
      <h2>7. Children's Privacy</h2>
      <p>
        Kenlibs is not directed at children under 13, and we don't knowingly
        collect information from anyone under that age. If you believe a
        child has created an account, please contact us so we can remove it.
      </p>
    </section>

    <section>
      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy as Kenlibs changes — for example,
        if we adopt a new service provider or add a new feature that
        collects different information. We'll update the "Last updated" date
        above whenever we do.
      </p>
    </section>

    <section>
      <h2>9. Contact</h2>
      <p>
        For any privacy-related question or request, reach us at:
      </p>
      <ul>
        <li>
          Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </li>
        <li>
          WhatsApp:{" "}
          <a href={SUPPORT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
            {SUPPORT_WHATSAPP_DISPLAY}
          </a>
        </li>
      </ul>
    </section>
  </KenlibsPolicyLayout>
);

export default KenlibsPrivacyPage;
