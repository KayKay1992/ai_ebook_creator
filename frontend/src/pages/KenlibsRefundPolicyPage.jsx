import KenlibsPolicyLayout from "../components/kenlibs/KenlibsPolicyLayout";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_HREF } from "../components/kenlibs/KenlibsFooter";

const KenlibsRefundPolicyPage = () => (
  <KenlibsPolicyLayout title="Refund Policy" lastUpdated="August 22, 2026">
    <section>
      <p>
        Kenlibs purchases are verified manually — you pay by bank transfer
        and upload evidence of that payment, and we confirm it before
        granting access. This policy explains what happens if something goes
        wrong.
      </p>
    </section>

    <section>
      <h2>If Your Payment Evidence Is Rejected</h2>
      <p>
        If we reject the evidence you submitted (for example, it's unclear
        or doesn't match the amount), you can resubmit new evidence for the
        same request at no extra cost. You don't need to make a new payment
        unless we specifically tell you one is needed — most rejections just
        mean we need a clearer or more complete screenshot/photo of the same
        transfer.
      </p>
    </section>

    <section>
      <h2>Requesting a Refund</h2>
      <p>
        Refunds are considered <strong>case-by-case</strong>. This covers
        situations like paying for the wrong book, a duplicate payment, or
        any other reason you believe you're owed money back. To request one,
        contact us directly with your name, the book or bundle you paid for,
        and the reason for your request:
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

    <section>
      <h2>If a Refund Is Approved</h2>
      <p>
        Because payments are made by direct bank transfer rather than
        through an automated payment processor, an approved refund is sent
        back manually to the same bank account you paid from, and your
        reading access to that book or bundle is removed. We'll confirm with
        you directly once it's been sent.
      </p>
    </section>

    <section>
      <p className="text-sm text-gray-500">
        This is a small, manually-run bookstore, so every request is
        reviewed by a real person rather than an automated system — reach
        out and we'll work it out with you directly.
      </p>
    </section>
  </KenlibsPolicyLayout>
);

export default KenlibsRefundPolicyPage;
