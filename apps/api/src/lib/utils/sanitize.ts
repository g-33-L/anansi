// Scrubs known secret patterns from text before it is chunked and embedded.
// Matched secrets are replaced with [REDACTED] so the LLM never surfaces them.

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

const PATTERNS: SecretPattern[] = [
  // Stripe
  { name: "stripe-secret", pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/g },
  { name: "stripe-publishable", pattern: /pk_(live|test)_[A-Za-z0-9]{20,}/g },
  { name: "stripe-webhook", pattern: /whsec_[A-Za-z0-9]{20,}/g },

  // GitHub
  { name: "github-token", pattern: /ghp_[A-Za-z0-9]{36,}/g },
  { name: "github-oauth", pattern: /gho_[A-Za-z0-9]{36,}/g },
  { name: "github-pat", pattern: /github_pat_[A-Za-z0-9_]{50,}/g },

  // Slack
  { name: "slack-bot-token", pattern: /xoxb-[0-9A-Za-z-]{40,}/g },
  { name: "slack-user-token", pattern: /xoxp-[0-9A-Za-z-]{40,}/g },
  { name: "slack-app-token", pattern: /xapp-[0-9A-Za-z-]{40,}/g },
  { name: "slack-signing", pattern: /xoxs-[0-9A-Za-z-]{40,}/g },

  // AWS
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  // A bare 40-char base64 blob is indistinguishable from a git commit SHA or a
  // content hash, so the secret-key pattern requires nearby AWS/secret-key
  // context (env-style `AWS_SECRET_ACCESS_KEY=`, JSON `"SecretAccessKey": "…"`,
  // or prose "aws secret … key …") before redacting.
  {
    name: "aws-secret",
    pattern:
      // Boundary guards: `=` is allowed *before* the token (assignments like
      // KEY=…) but not after (base64 padding means the token continues).
      /\b(?:aws[\w\s"':=,._-]{0,30}?(?:secret|key|credential)|secret[\s_-]?access[\s_-]?key)[\w\s"':=,._-]{0,15}?(?<![A-Za-z0-9/+])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  },

  // OpenAI / generic sk- keys
  { name: "openai-key", pattern: /sk-[A-Za-z0-9]{32,}/g },

  // Nomic
  { name: "nomic-key", pattern: /nk-[A-Za-z0-9_-]{30,}/g },

  // Anthropic
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{30,}/g },

  // PEM private keys
  { name: "pem-private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },

  // Generic key=value patterns (password, secret, token, api_key assignments)
  {
    name: "generic-secret-assignment",
    pattern: /\b(password|passwd|secret|api_key|apikey|api-key|token|auth_token|access_token|private_key)\s*[:=]\s*["']?[A-Za-z0-9+/=_.-]{8,}["']?/gi,
  },
];

export function sanitizeText(text: string): { text: string; redactedCount: number } {
  let result = text;
  let redactedCount = 0;

  for (const { pattern } of PATTERNS) {
    pattern.lastIndex = 0; // reset stateful global regex
    result = result.replace(pattern, () => {
      redactedCount++;
      return "[REDACTED]";
    });
  }

  return { text: result, redactedCount };
}

// ─── Prompt-delimiter neutralization ─────────────────────────────────────────
// Trust boundary: chunk/message content, caller-supplied metadata, and the
// profile facts derived from them all originate with API callers — and,
// transitively, with a developer's end-users. LLM prompts fence untrusted
// blocks between `--- BEGIN X ---` / `--- END X ---` lines, and the workspace
// query parser keys on a line-start `CITED:` control line in the model output.
// Untrusted text that forges one of those markers can break out of its fence
// and inject instructions — and because the workspace profile is shared, a
// single end-user could poison context served to every other user of that
// developer. Rewrite the markers (rather than dropping content) before any
// untrusted text is interpolated into a prompt.

// `--- BEGIN …` / `--- END …` at any position, not just line starts — untrusted
// text is also embedded inside JSON strings, where line anchors don't apply.
const FENCE_MARKER = /-{3,}(\s*)(BEGIN|END)\b/gi;
// Line-start `CITED:` — the query answer parser matches /\nCITED:/.
const CITED_LINE = /^([ \t]*)CITED:/gim;

export function neutralizePromptDelimiters(text: string): string {
  return text.replace(FENCE_MARKER, "- - -$1$2").replace(CITED_LINE, "$1CITED :");
}
