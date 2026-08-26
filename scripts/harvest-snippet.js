// Paste into the DevTools console on a resort's Facebook page, once per page
// load. Defines harvest(). Filter and scroll the feed yourself, then call
// harvest() to pull every post currently in the DOM onto the clipboard.
//
//   await harvest()          expand "See more", extract, copy
//   await harvest({expand:false})   skip the expansion clicks
//   copy(__out)              if the auto-copy was blocked
//
// Deliberately keys off role="article" and href shape, never Facebook's
// generated class names, which change without notice.

(() => {
  const MONTHS = ["January","February","March","April","May","June","July",
                  "August","September","October","November","December"];
  const DATE_RE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:,\\s*(20\\d{2}))?\\b`);
  const PERMALINK_RE = /\/(posts|permalink\.php|videos|photos|photo|story\.php|reel)\b|story_fbid=/;

  // Everything below the post body: reaction counts, comment threads, the
  // composer. Cutting at the first of these keeps evidence text to the post's
  // own words.
  const CHROME_RE = /^(All reactions:|Like\b|Comment\b|Share\b|Most relevant|View more comments|Write a comment)/m;

  const clean = t => {
    // The "See less" toggle sits at the end of an expanded post body, above the
    // reaction counts and the comment thread. Cutting there before the length
    // cap keeps a long post's own words instead of its comments.
    const toggle = t.search(/^\s*See (less|more)\s*$/m);
    if (toggle > 40) t = t.slice(0, toggle);
    const cut = t.search(CHROME_RE);
    return (cut > 0 ? t.slice(0, cut) : t).replace(/\s*\n\s*/g, "\n").trim().slice(0, 4000);
  };

  const permalinkOf = article => {
    for (const a of article.querySelectorAll("a[href]")) {
      const href = a.href || "";
      if (!href.includes("facebook.com")) continue;
      if (PERMALINK_RE.test(href)) return href.split("?")[0].includes("permalink.php") ? href : href.split("?")[0];
    }
    return null;
  };

  // Facebook renders an absolute date on anything older than a year, which is
  // every season we care about. A post still showing "22h" gets a null date
  // rather than a guessed one.
  const dateOf = article => {
    for (const a of article.querySelectorAll("a[href]")) {
      if (!PERMALINK_RE.test(a.href || "")) continue;
      for (const s of [a.innerText, a.getAttribute("aria-label")]) {
        const m = s && DATE_RE.exec(s);
        if (m) return m[0];
      }
    }
    const head = (article.innerText || "").slice(0, 300);
    const m = DATE_RE.exec(head);
    return m ? m[0] : null;
  };

  // These hills bake the schedule into a graphic and write two words of caption:
  // Elm Creek's 16 Dec 2021 post said only "Opening this weekend" while the
  // image carried "Sat 18 / Sun 19". Facebook auto-describes photos and often
  // OCRs the words inside them, so the alt text is the only handle on that
  // detail from the DOM. It is machine-read and sometimes wrong — a lead that
  // says which image to go look at, never evidence to quote.
  const altsOf = article =>
    [...new Set(
      [...article.querySelectorAll("img[alt]")]
        .map(i => (i.getAttribute("alt") || "").trim())
        .filter(a => a.length > 15 && !/^(profile picture|may be an image of\.?)$/i.test(a)),
    )].slice(0, 6);

  const idOf = (permalink, text) => {
    if (permalink) {
      const pfbid = /(pfbid[0-9A-Za-z]+)/.exec(permalink);
      if (pfbid) return pfbid[1];
      const fbid = /(?:story_fbid|fbid)=(\d+)/.exec(permalink);
      if (fbid) return fbid[1];
      const num = /\/(\d{8,})\/?$/.exec(permalink);
      if (num) return num[1];
    }
    let h = 0;
    for (const ch of text.slice(0, 400)) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
    return "t" + (h >>> 0).toString(36);
  };

  const expandAll = async () => {
    const buttons = [...document.querySelectorAll('div[role="button"], span[role="button"]')]
      .filter(b => /^see more$/i.test((b.innerText || "").trim()));
    for (const b of buttons) { try { b.click(); } catch {} }
    if (buttons.length) await new Promise(r => setTimeout(r, 600));
    return buttons.length;
  };

  const store = (window.__harvestStore ||= new Map());

  window.harvest = async ({ expand = true } = {}) => {
    const expanded = expand ? await expandAll() : 0;
    let fresh = 0;
    for (const article of document.querySelectorAll('div[role="article"]')) {
      // Comment bodies are articles too; the outer post is the one that is not
      // nested inside another article.
      if (article.parentElement?.closest('div[role="article"]')) continue;
      const text = clean(article.innerText || "");
      if (text.length < 20) continue;
      const permalink = permalinkOf(article);
      const id = idOf(permalink, text);
      const post = { id, date: dateOf(article), url: permalink, text, alt: altsOf(article) };
      const prior = store.get(id);
      // A later pass may catch an expanded body where the first saw "See more".
      if (!prior) fresh++;
      if (!prior || post.text.length > prior.text.length) store.set(id, post);
    }

    const posts = [...store.values()];
    const dated = posts.filter(p => p.date).length;
    window.__out = JSON.stringify({ url: location.href, posts }, null, 1);

    let copied = false;
    try { await navigator.clipboard.writeText(window.__out); copied = true; } catch {}
    if (!copied) {
      try {
        const ta = document.createElement("textarea");
        ta.value = window.__out;
        document.body.appendChild(ta); ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {}
    }

    console.log(
      `harvest: ${posts.length} posts (${fresh} new this call, ${dated} dated)` +
      (expanded ? `, expanded ${expanded}` : "") +
      (copied ? " — copied to clipboard" : " — COPY FAILED, run: copy(__out)")
    );
    return posts.length;
  };

  console.log("harvest() ready. Filter and scroll, then: await harvest()");
})();
