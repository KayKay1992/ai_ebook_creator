// One-off/manual admin-promotion utility — deliberately NOT exposed via any
// HTTP route. Per KENLIBS-ARCHITECTURE.md: "There is deliberately no
// self-service way to become an admin — that's set directly in the
// database or by an existing admin, never through a public form."
//
// Usage:
//   node scripts/setAdmin.js <email> [newPassword]
//
// Sets the user's role to 'admin'. If newPassword is given, it's set via
// the User model's own pre('save') hook (never written or logged in
// plaintext) rather than a raw update, so it's bcrypt-hashed exactly the
// same way a normal password change is.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const [, , email, newPassword] = process.argv;

if (!email) {
  console.error("Usage: node scripts/setAdmin.js <email> [newPassword]");
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    user.role = "admin";
    if (newPassword) {
      user.password = newPassword; // hashed by User.js's pre('save') hook
    }
    await user.save();

    console.log("Updated user:");
    console.log({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      passwordChanged: Boolean(newPassword),
    });
  } catch (err) {
    console.error("Failed to set admin:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
