/**
 * A tiny stand-in for a browser without JavaScript: keeps cookies, submits forms
 * the way a native <form method="post"> does (urlencoded body, Origin header), and
 * follows redirects (POST → 30x → GET), remembering every hop.
 */
export interface Visit {
  readonly status: number;
  /** Path + query of the final response. */
  readonly path: string;
  /** Location of every redirect that was followed (or returned, with `follow: false`). */
  readonly redirects: ReadonlyArray<string>;
  readonly headers: Headers;
  readonly html: string;
}

export class Browser {
  readonly #cookies = new Map<string, string>();

  constructor(readonly baseUrl: URL) {}

  /** GET a page. */
  get(path: string, options: { readonly follow?: boolean } = {}): Promise<Visit> {
    return this.#visit("GET", path, undefined, options.follow ?? true, {});
  }

  /** Submit a form (POST, urlencoded) the way the page itself would. */
  submit(
    path: string,
    fields: Record<string, string>,
    options: { readonly follow?: boolean; readonly origin?: string } = {},
  ): Promise<Visit> {
    return this.#visit("POST", path, new URLSearchParams(fields), options.follow ?? true, {
      Origin: options.origin ?? this.baseUrl.origin,
    });
  }

  get visitorId(): string | undefined {
    return this.#cookies.get("jev_vid");
  }

  async #visit(
    method: "GET" | "POST",
    path: string,
    body: URLSearchParams | undefined,
    follow: boolean,
    headers: Record<string, string>,
  ): Promise<Visit> {
    const redirects: Array<string> = [];
    let url = new URL(path, this.baseUrl);
    for (let hop = 0; ; hop++) {
      const response = await fetch(url, {
        method,
        body,
        redirect: "manual",
        headers: { ...headers, ...(this.#cookies.size > 0 ? { Cookie: this.#cookieHeader() } : {}) },
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) this.#cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const location = response.headers.get("Location");
      if (response.status >= 300 && response.status < 400 && location) {
        redirects.push(location);
        if (follow && hop < 10) {
          await response.body?.cancel();
          url = new URL(location, url);
          // Browsers turn a redirected form POST into a GET.
          method = "GET";
          body = undefined;
          headers = {};
          continue;
        }
      }
      return {
        status: response.status,
        path: url.pathname + url.search,
        redirects,
        headers: response.headers,
        html: await response.text(),
      };
    }
  }

  #cookieHeader(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** React splits adjacent text nodes with `<!-- -->` in server-rendered HTML; drop those. */
export const textOf = (html: string): string => html.replaceAll("<!-- -->", "");

/** The document <title>, with HTML entities for &, <, > and quotes decoded. */
export const titleOf = (html: string): string =>
  (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
