# Deploying the SEO branch

Written for clicking through the Render dashboard. No terminal, no SSH.

**Do these in order.** Step 2 is not optional: if the branch is deployed while
the old catch-all rule is still in place, the new per-page files may never be
served and every wrong URL will keep answering "200 OK" with the home page.

---

## Step 1. Merge the branch

The branch is `seo/crawlability-and-metadata`. Review it, then merge it into
the branch Render deploys from (`main`). Render will start a build on its own.

The build command for the frontend service must be `yarn build` (or
`npm run build`). That already runs the new prerender step, so there is nothing
to change there.

**If the build fails with a red `[prerender] FATAL` message, that is on
purpose.** It means the backend did not answer while the site was being built,
and the script refused to publish pages with no content on them. Your current
live site is untouched. Wait a minute for the backend to wake up and click
"Manual Deploy" to try again.

---

## Step 2. Replace the redirect rule in Render

This is the rule we added a while ago to stop pages saying "Not Found" when you
reloaded them.

1. Go to the Render dashboard and open the **frontend** static site (the one
   serving www.scale-national.com, not the backend).
2. In the left menu click **Redirects/Rewrites**.
3. You will see one existing rule:
   - Source `/*`, Destination `/index.html`, Action **Rewrite**
   **Delete it.** Click the bin/trash icon next to it.
4. Now add these four rules, one at a time, each with Action **Rewrite**:

   | Source | Destination | Action |
   |---|---|---|
   | `/events/:id/scholarship` | `/app-noindex.html` | Rewrite |
   | `/events/:id/registered` | `/app-noindex.html` | Rewrite |
   | `/payment/:registrationId` | `/app-noindex.html` | Rewrite |
   | `/p/*` | `/app-noindex.html` | Rewrite |

5. Click **Save Changes**. Render redeploys.

### Why the big rule has to go

The old `/*` rule said "whatever anyone asks for, hand them the app". That is
what fixed reloading, but it also meant every possible address on your site
answered "yes, this page exists" with a blank app shell, including typos,
deleted events and `/sitemap.xml`. Google reads that as a real page and
indexes junk, and a deleted competition never actually disappears.

After this deploy there is a genuine file on the server for every real page, so
reloads and shared links work without a catch-all. The four rules above cover
the only addresses that cannot be known in advance: a student's payment page, a
confirmation page, a scholarship form and admin-created pages. Anything that
matches nothing now returns a real "Page not found" with a real 404 code.

---

## Step 3. Check it worked (two minutes)

Open these in a browser. You should see:

| Address | What you should get |
|---|---|
| `www.scale-national.com` | the normal home page |
| `www.scale-national.com/courses` | the courses page |
| the competition page link you share with students | the competition page, as always |
| reload any of those with F5 | the same page, no "Not Found" |
| `www.scale-national.com/robots.txt` | a few lines of plain text |
| `www.scale-national.com/sitemap.xml` | a list of your page addresses |
| `www.scale-national.com/this-page-does-not-exist` | a black "Page not found" screen |

Then sign in, open the admin console, and open a course. If all of that behaves
normally, the deploy is good.

---

## Step 4. Tell Google the site exists

The technical work only removes obstacles. Google still has to be told.

1. Go to **search.google.com/search-console** and sign in with the Google
   account you want to own this.
2. Add a property for `www.scale-national.com`. It will ask you to prove you
   own the domain. Choose the **domain** option and it will give you a line of
   text to add as a **TXT record** in GoDaddy (GoDaddy: My Products, DNS,
   Add Record, type TXT). Paste it in, save, then click Verify.
3. Once verified, open **Sitemaps** in the left menu and submit `sitemap.xml`.
4. Open **URL Inspection**, paste in your competition page address, and click
   **Request Indexing**.

Step 4 is the part that actually gets pages into Google. Everything before it
just makes sure that when Google looks, there is something to read.

---

## What this does not do

Being crawlable is not the same as ranking. For a competitive phrase like
"business case competition", Google mostly ranks pages that other websites link
to. Nothing in this branch creates links from other websites, because that is
off-site work you said you would handle yourself.

What should realistically improve:

- Searches for "SCALE", "SCALE national", "SCALE case competition" and similar
  brand terms. The site should start showing a proper title and description.
- Long, specific phrases, for example "free online business case competition
  for school students in India".
- What AI assistants say when someone pastes your link or asks about SCALE by
  name. They can now read the page instead of receiving a blank shell.

What will not change on its own: ranking for broad phrases like "case
competition" or "student case competition India". Those need other sites
linking to yours.
