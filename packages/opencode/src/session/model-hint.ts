// Downstream-only fork feature.
//
// Parses the `/_switch <alias_or_model>` directive at the start of a user
// message. Returns the raw token plus the message text with the directive
// stripped. Resolution of the token to an actual `Provider.Model` happens in
// `provider/provider.ts::resolveSwitchToken` so this file can stay free of
// Effect/service dependencies and remain a pure unit-testable function.
//
// The leading `/_` (slash-underscore) marks every fork-only feature in this
// repo. Upstream slash-commands never start with `_`, so the slash-command
// resolver and the inline directive cannot collide.

// Matches: `/_switch <token>` at the start (after optional leading whitespace),
// followed by either whitespace OR the end of the string. The token allows
// alphanumerics, `-`, `_`, `.`, `:`, and `/` so it covers both bare aliases
// (e.g. `sonnet`) and the canonical `provider/model-id` form
// (e.g. `anthropic/claude-sonnet-4-5`).
const MODEL_HINT_REGEX = /^\/_switch[ \t]+([\w./:-]+)(?:[ \t]+|\r?\n|$)/

export interface ModelHint {
  /** Raw token the user typed: alias or `provider/model-id`. */
  token: string
  /** The message text with the directive token stripped. */
  remainder: string
}

/**
 * Parse an optional `/_switch <token>` prefix from message text.
 * Returns undefined if no directive is present.
 *
 * Only the very start of the message is matched. Mid-message directives are
 * intentionally not parsed — see future-inline-model-switch.md §5.4.
 */
export function parseModelHint(text: string): ModelHint | undefined {
  const trimmed = text.replace(/^[ \t]+/, "")
  const match = MODEL_HINT_REGEX.exec(trimmed)
  if (!match) return undefined
  return {
    token: match[1],
    remainder: trimmed.slice(match[0].length).replace(/^[ \t]+/, ""),
  }
}
