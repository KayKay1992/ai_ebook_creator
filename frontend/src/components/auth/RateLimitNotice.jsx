import { Clock } from "lucide-react";

// Shown on the login and forgot-password pages when the server says "too
// many attempts" (utils/rateLimit.js). Says nothing about the account.
const RateLimitNotice = ({ message }) =>
  message ? (
    <p
      role="alert"
      className="flex items-start gap-2 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-5"
    >
      <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </p>
  ) : null;

export default RateLimitNotice;
