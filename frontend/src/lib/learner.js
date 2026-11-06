// Lightweight localStorage helper for the Courses/LMS learner identity —
// deliberately separate keys from the admin "scale_token"/"scale_user" so a
// learner signup never collides with an admin session in the same browser.
const TOKEN_KEY = "scale_learner_token";
const NAME_KEY = "scale_learner_name";
const EMAIL_KEY = "scale_learner_email";

export function getLearner() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return {
    token,
    name: localStorage.getItem(NAME_KEY) || "",
    email: localStorage.getItem(EMAIL_KEY) || "",
  };
}

export function setLearner({ token, name, email }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, name || "");
  localStorage.setItem(EMAIL_KEY, email || "");
}

export function clearLearner() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(EMAIL_KEY);
}
