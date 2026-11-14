# Gravitunes

NASA Space Apps 2026 "Earth Information Jukebox": turn NASA Earth visualizations into sound, as an interactive web experience that is accessible to blind and low-vision users. Challenge brief: `docs/`. Folder structure: `docs/structure.md`.

New ways to show or hear the data go in `app/modes/<name>/` (copy `_template`). Ideas are described in `docs/ideas/`.

If you are the session talking with the user, delegate code changes to background subagents, each in its own git worktree, so you stay free for discussion. Subagents do the work themselves (no further delegation). Work autonomously; don't ask the user about git steps. Subagents just commit in their worktree (git: only status/diff/log/add/commit; never reset, merge, rebase or cherry-pick). The main session applies their diff (`git diff --output=` + `git apply --3way`), tests and commits with a very short message. If the main checkout has unrelated uncommitted changes, don't mix them in; ask the user. Never push.
