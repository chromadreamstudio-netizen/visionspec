╭─ error ──────────────────────────────────────────────────────────────────────╮
│                                                                              │
│  Validation errors in                                                        │
│  D:/E/0/Projects/visionspec-pro/shopify.app.visionspec-pro.toml:             │
│                                                                              │
│  [webhooks]: Required                                                        │
│                                                                              │

D:\E\0\Projects\visionspec-pro>npm run deploy
npm notice run deploy
npm notice run shopify app deploy
╭─ info ───────────────────────────────────────────────────────────────────────╮
│                                                                              │
│  Using shopify.app.visionspec-pro.toml for default values:                   │
│                                                                              │
│    • Org:             Kian Tech Solutions                                    │
│    • App:             visionspec-pro                                         │
│                                                                              │
│   You can pass `--reset` to your command to reset your app configuration.    │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯

?  Release a new version of visionspec-pro?
√  Yes, release this new version


Releasing a new app version as part of visionspec-pro


╭─ success ────────────────────────────────────────────────────────────────────╮
│                                                                              │
│  New version released to users.                                              │
│                                                                              │
│  visionspec-pro-4 [1]                                                        │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
[1] https://dev.shopify.com/dashboard/241942883/apps/439649796097/versions/1181043326977


D:\E\0\Projects\visionspec-pro>git add
Nothing specified, nothing added.
hint: Maybe you wanted to say 'git add .'?
hint: Disable this message with "git config set advice.addEmptyPathspec false"

D:\E\0\Projects\visionspec-pro>git add .
warning: in the working copy of 'shopify.app.toml', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'shopify.app.visionspec-pro.toml', LF will be replaced by CRLF the next time Git touches it

D:\E\0\Projects\visionspec-pro>git commit -m "Upgrade to Smart Listing AI Engine"
[main 937a8f7] Upgrade to Smart Listing AI Engine
 3 files changed, 238 insertions(+), 105 deletions(-)

D:\E\0\Projects\visionspec-pro>git push origin main
Enumerating objects: 13, done.
Counting objects: 100% (13/13), done.
Delta compression using up to 12 threads
Compressing objects: 100% (7/7), done.
Writing objects: 100% (7/7), 4.15 KiB | 1.38 MiB/s, done.
Total 7 (delta 5), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (5/5), completed with 5 local objects.
To https://github.com/chromadreamstudio-netizen/visionspec.git
   0db842c..937a8f7  main -> main

D:\E\0\Projects\visionspec-pro>git add .

D:\E\0\Projects\visionspec-pro>git commit -m "Fix syntax error in prompt string"
[main 64dde3a] Fix syntax error in prompt string
 1 file changed, 10 insertions(+), 22 deletions(-)

D:\E\0\Projects\visionspec-pro>git push origin main
Enumerating objects: 9, done.
Counting objects: 100% (9/9), done.
Delta compression using up to 12 threads
Compressing objects: 100% (5/5), done.
Writing objects: 100% (5/5), 514 bytes | 514.00 KiB/s, done.
Total 5 (delta 4), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (4/4), completed with 4 local objects.
To https://github.com/chromadreamstudio-netizen/visionspec.git
   937a8f7..64dde3a  main -> main

D:\E\0\Projects\visionspec-pro>git add .

D:\E\0\Projects\visionspec-pro>git commit -m "Upgrade to Enterprise Smart Listing & SEO Engine"
[main 708fcbc] Upgrade to Enterprise Smart Listing & SEO Engine
 1 file changed, 374 insertions(+), 128 deletions(-)

D:\E\0\Projects\visionspec-pro>git push origin main
Enumerating objects: 9, done.
Counting objects: 100% (9/9), done.
Delta compression using up to 12 threads
Compressing objects: 100% (5/5), done.
Writing objects: 100% (5/5), 6.29 KiB | 3.14 MiB/s, done.
Total 5 (delta 4), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (4/4), completed with 4 local objects.
To https://github.com/chromadreamstudio-netizen/visionspec.git
   64dde3a..708fcbc  main -> main

D:\E\0\Projects\visionspec-pro>git add .

D:\E\0\Projects\visionspec-pro>git commit -m "Update model to gemini-3.6-flash"
[main d744cd4] Update model to gemini-3.6-flash
 1 file changed, 1 insertion(+), 1 deletion(-)

D:\E\0\Projects\visionspec-pro>git push origin main
Enumerating objects: 9, done.
Counting objects: 100% (9/9), done.
Delta compression using up to 12 threads
Compressing objects: 100% (5/5), done.
Writing objects: 100% (5/5), 435 bytes | 435.00 KiB/s, done.
Total 5 (delta 4), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (4/4), completed with 4 local objects.
To https://github.com/chromadreamstudio-netizen/visionspec.git
   708fcbc..d744cd4  main -> main

D:\E\0\Projects\visionspec-pro>git add .

D:\E\0\Projects\visionspec-pro>git commit -m "Add dual mode create and enhance
[main d3e1da5] Add dual mode create and enhance
 1 file changed, 258 insertions(+), 270 deletions(-)

D:\E\0\Projects\visionspec-pro>git push origin main
Enumerating objects: 9, done.
Counting objects: 100% (9/9), done.
Delta compression using up to 12 threads
Compressing objects: 100% (5/5), done.
Writing objects: 100% (5/5), 3.55 KiB | 909.00 KiB/s, done.
Total 5 (delta 4), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (4/4), completed with 4 local objects.
To https://github.com/chromadreamstudio-netizen/visionspec.git
   d744cd4..d3e1da5  main -> main

D:\E\0\Projects\visionspec-pro>
