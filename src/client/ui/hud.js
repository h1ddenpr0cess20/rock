/**
 * Everything the page shows but doesn't take input from: the state chip, the
 * line of what you said, Rock's caption, and the tool strip.
 *
 * Read-only by design — it renders what it's told and never reaches for the
 * session.
 */

/* The persona asks for no markdown, and mostly gets none. These cover the times
   it forgets. Inline spans only; order matters — `code` first, `**` before `*`. */
const INLINE = [
  { tag: 'code', re: /`([^`\n]+)`/ },
  { tag: 'strong', re: /\*\*(\S|\S[\s\S]*?\S)\*\*/ },
  { tag: 'strong', re: /__(\S|\S[\s\S]*?\S)__/ },
  { tag: 's', re: /~~(\S|\S[\s\S]*?\S)~~/ },
  // Guarded on both sides, so snake_case and `3 * 4 * 5` stay as they were said.
  { tag: 'em', re: /(?<![\w*])\*(\S|\S[\s\S]*?\S)\*(?!\w)/ },
  { tag: 'em', re: /(?<![\w_])_(\S|\S[\s\S]*?\S)_(?!\w)/ },
];

/** The leftmost span in `text`, ties going to whichever rule is listed first. */
function firstSpan(text) {
  let found = null;
  for (const { tag, re } of INLINE) {
    const m = re.exec(text);
    if (m && (!found || m.index < found.at)) {
      found = { tag, at: m.index, width: m[0].length, body: m[1] };
    }
  }
  return found;
}

/** Markdown → nodes. Never innerHTML: this is model output. */
function render(text, into) {
  let rest = text;
  for (let span = firstSpan(rest); span; span = firstSpan(rest)) {
    if (span.at) into.append(rest.slice(0, span.at));
    const el = into.ownerDocument.createElement(span.tag);
    // Everything nests except code, where the point is that it doesn't.
    if (span.tag === 'code') el.append(span.body);
    else render(span.body, el);
    into.append(el);
    rest = rest.slice(span.at + span.width);
  }
  if (rest) into.append(rest);
  return into;
}

export function createHud(root = document) {
  const statusEl = root.querySelector('#status');
  const captionEl = root.querySelector('#caption');
  const youEl = root.querySelector('#you');
  const toolEl = root.querySelector('#tool');

  return {
    /** idle | listening | thinking | speaking, plus the synthetic 'connecting'. */
    setState(state) {
      statusEl.dataset.state = state;
      statusEl.textContent = state;
    },

    showUser(text) {
      youEl.textContent = text;
      youEl.classList.add('visible');
    },

    hideUser() {
      youEl.classList.remove('visible');
    },

    /** The whole turn, every time — xAI's transcripts are cumulative, so there
     *  is nothing to append to. Re-rendered whole for the same reason a
     *  streaming renderer would be: a span and its closer arrive separately. */
    setCaption(text) {
      captionEl.classList.remove('error');
      captionEl.classList.add('visible');
      captionEl.replaceChildren();
      render(text, captionEl);
      captionEl.scrollTop = captionEl.scrollHeight;
    },

    clearCaption() {
      captionEl.replaceChildren();
      captionEl.classList.remove('visible', 'error');
    },

    /** A label while a server-side tool works, or null to clear it. */
    setTool(label) {
      toolEl.textContent = label ?? '';
      toolEl.classList.toggle('visible', Boolean(label));
    },

    showError(message) {
      captionEl.textContent = message; // ours, not Rock's: shown verbatim
      captionEl.classList.add('visible', 'error');
    },

    /** The tool strip under the composer — what this build can actually reach. */
    showTools({ web_search: web, x_search: x, mcp }) {
      const names = [web && 'web', x && 'X', ...mcp].filter(Boolean);
      const el = root.querySelector('#tools');
      el.textContent = names.length ? `tools: ${names.join(' · ')}` : '';
      el.classList.toggle('visible', names.length > 0);
    },
  };
}
