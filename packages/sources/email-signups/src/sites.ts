// Sites that tell, in one request, whether an email has an account. Ported from user-scanner (MIT).
export type SignupSite = {
  name: string;
  // Shown to the user; the request itself goes to `check.url`.
  url: string;
  // Which of the site's forms answers the question, so the user knows what the site may see or send.
  via: "sign-up form" | "password reset" | "login form";
  check: {
    method: "GET" | "POST";
    // "{email}" is replaced by the URL-encoded address.
    url: string;
    headers: Readonly<Record<string, string>>;
    // "{email}" is replaced too (JSON-escaped for JSON bodies, URL-encoded otherwise); null for GET.
    body: string | null;
  };
  // Any of these in a 200 answer means registered / not registered; both or neither is inconclusive.
  foundText: readonly string[];
  missingText: readonly string[];
};

export const BUNDLED_SIGNUP_SITES: readonly SignupSite[] = [
  {
    name: "Hugging Face",
    url: "https://huggingface.co",
    via: "sign-up form",
    check: {
      method: "POST",
      url: "https://huggingface.co/api/check-user-email",
      headers: { "content-type": "application/json", referer: "https://huggingface.co/join" },
      body: '{"email":"{email}"}',
    },
    foundText: ["already exists"],
    missingText: ["This email address is available."],
  },
  {
    name: "WordPress.com",
    url: "https://wordpress.com",
    via: "login form",
    check: {
      method: "GET",
      url: "https://public-api.wordpress.com/rest/v1.1/users/{email}/auth-options?http_envelope=1",
      headers: { accept: "application/json" },
      body: null,
    },
    // The envelope keeps HTTP 200 and puts the real status in "code"; 403 email_login_not_allowed is a real account.
    foundText: ['"code":200', '"email_login_not_allowed"'],
    missingText: ['"unknown_user"'],
  },
];
