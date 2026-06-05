import hljs from "highlight.js";

/**
 * Split highlight.js HTML output into per-line strings, carrying unclosed
 * `<span>` tags across line breaks so each line is independently renderable.
 */
export function splitHighlightedHtml(html: string): string[] {
	const rawLines = html.split("\n");
	const result: string[] = [];
	let openTags: string[] = [];

	for (const rawLine of rawLines) {
		const line = openTags.join("") + rawLine;

		// Track open/close span tags
		const tags: string[] = [];
		const tagRe = /<(\/?)span([^>]*)>/g;
		let m: RegExpExecArray | null = tagRe.exec(line);
		while (m !== null) {
			if (m[1] === "/") {
				if (tags.length > 0) tags.pop();
			} else {
				tags.push(m[0]);
			}
			m = tagRe.exec(line);
		}

		// Close unclosed tags at end of line
		result.push(line + "</span>".repeat(tags.length));
		openTags = tags;
	}

	return result;
}

/**
 * Highlight `content` and return per-line HTML strings. Falls back to plain
 * text lines for plaintext / unsupported languages / highlight errors.
 */
export function highlightCode(content: string, language: string): string[] {
	if (!language || language === "plaintext" || !hljs.getLanguage(language)) {
		return content.split("\n");
	}
	try {
		const result = hljs.highlight(content, { language, ignoreIllegals: true });
		return splitHighlightedHtml(result.value);
	} catch {
		return content.split("\n");
	}
}
