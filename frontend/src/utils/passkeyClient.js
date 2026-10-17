import axiosInstance from "./axiosInstance";
import { API_PATHS } from "./apiPaths";

// Passkey sign-in and registration (backend controller/passkeyController.js).
// @simplewebauthn/browser is imported on demand, so it's only downloaded
// when someone actually uses a passkey, never by the storefront or reader.
const loadWebAuthn = () => import("@simplewebauthn/browser");

// Signs in with a passkey (email optional). Resolves to the same data as a
// password login: { message, _id, name, email, role, token }.
export const signInWithPasskey = async ({ email = "" } = {}) => {
  const { startAuthentication } = await loadWebAuthn();
  const start = await axiosInstance.post(API_PATHS.PASSKEYS.LOGIN_OPTIONS, email ? { email } : {});
  const response = await startAuthentication({ optionsJSON: start.data.options });
  const verify = await axiosInstance.post(API_PATHS.PASSKEYS.LOGIN_VERIFY, { flowId: start.data.flowId, response });
  return verify.data;
};

// Adds a passkey to the signed-in account. `password` is only needed when
// the sign-in is older than 10 minutes (the server answers 403
// code "password_required" otherwise). Resolves to the new passkey's info.
export const addPasskey = async ({ nickname, password } = {}) => {
  const { startRegistration } = await loadWebAuthn();
  const start = await axiosInstance.post(API_PATHS.PASSKEYS.REGISTER_OPTIONS, password ? { password } : {});
  const response = await startRegistration({ optionsJSON: start.data.options });
  const verify = await axiosInstance.post(API_PATHS.PASSKEYS.REGISTER_VERIFY, { flowId: start.data.flowId, response, nickname });
  return verify.data.passkey;
};

export { passkeyErrorMessage, passkeyErrorCode } from "./passkeyErrors";
