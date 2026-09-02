# Putting the site on whencanishred.com

Checked 31 August 2026: the domain was unregistered (`whois` returned "No match",
no DNS of any kind).

Order matters here. Adding the `CNAME` file before DNS resolves takes the site
offline: GitHub Pages starts insisting on the custom domain and redirects
`pete2786.github.io/whencanishred` to a hostname that does not answer yet.

## 1. Register it

Namecheap, the same as `operationdefrost.app`, which already runs this exact
setup: Namecheap BasicDNS on `dns1/dns2.registrar-servers.com`, pointed at the
four GitHub Pages addresses. Nothing below is new ground.

Turn on auto-renew. A lapsed domain printed across seven Instagram frames is not
a recoverable mistake. Namecheap includes WHOIS privacy free, so leave it on.

## 2. Point DNS at GitHub Pages

Domain List, Manage, **Advanced DNS**.

**Delete the parking records first.** Namecheap ships every new domain with a
CNAME on `www` pointing at its parking page and sometimes an A record on `@`.
Both have to go or they will fight the records below.

Four A records, host `@`, TTL Automatic:

    185.199.108.153
    185.199.109.153
    185.199.110.153
    185.199.111.153

Four AAAA records, also host `@`:

    2606:50c0:8000::153
    2606:50c0:8001::153
    2606:50c0:8002::153
    2606:50c0:8003::153

One CNAME record, host `www`, value:

    pete2786.github.io.

The trailing dot matters. Namecheap usually adds it for you; check that it is
there afterwards.

## 3. Wait for it to resolve

    dig +short whencanishred.com A

Do not go on until that returns the four addresses above. Usually minutes,
occasionally an hour.

## 4. Claim it in the repo

    echo "whencanishred.com" > CNAME
    git add CNAME && git commit -m "Serve from whencanishred.com" && git push

The file has to sit at the repo root with no trailing anything but a newline.
GitHub Pages reads it on the next build and moves the site.

## 5. Enforce HTTPS

Settings, then Pages. The custom domain should already be filled in from the
`CNAME` file. Wait for the certificate to be issued, then tick **Enforce
HTTPS**. It can take a few minutes and the tickbox is greyed out until the
certificate lands.

## 6. Check

    curl -sI https://whencanishred.com | head -1        # expect 200
    curl -sI http://whencanishred.com | head -1         # expect 301 to https
    curl -sI https://www.whencanishred.com | head -1    # expect 301 to apex

## Afterwards

Two things become worth doing the moment the domain is live:

- **Analytics.** One script tag in the three templates. Nothing measures traffic
  today, so the first post's effect is currently unknowable. Namecheap does not
  bundle analytics the way Cloudflare does, so this needs picking: Cloudflare Web
  Analytics and GoatCounter are both free and neither needs a cookie banner.
- **`og:image`.** The templates carry `og:title` and `og:description` but no
  image, so every share renders as a grey box. A 1200x630 frame is one more
  geometry through `social/make.mjs`.
