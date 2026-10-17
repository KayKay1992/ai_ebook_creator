import { lazy, Suspense, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { peekPasskeyPromptFlag } from "../../utils/passkeySupport";

// Mounted once in App.jsx. After a password sign-in (the login pages set a
// session flag), shows the one-time PasskeyPrompt on the page the user
// lands on (it clears the flag). Loads nothing unless that flag is set.
const PasskeyPrompt = lazy(() => import("./PasskeyPrompt"));
const LOGIN_PATHS = ["/login", "/kenlibs/login"];

const PasskeyPromptHost = () => {
  const { user, isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);

  // Latched once, while rendering after sign-in and navigation.
  if (!show && isAuthenticated && user && !LOGIN_PATHS.includes(pathname) && peekPasskeyPromptFlag()) {
    setShow(true);
  }

  if (!show || !user) return null;
  return (
    <Suspense fallback={null}>
      <PasskeyPrompt user={user} profilePath={user.role === "admin" ? "/profile" : "/kenlibs/profile"} />
    </Suspense>
  );
};

export default PasskeyPromptHost;
