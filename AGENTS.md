# Repository Guidelines

## Project Structure & Module Organization

This repository is a Hexo 7 blog. Site settings live in `_config.yml`; npm dependencies and scripts are in `package.json`. Blog content is stored in `source/_posts/` as Markdown. Supporting pages such as tags, categories, links, and charts live under `source/`. Post templates are in `scaffolds/`. The active theme is Euler, with configuration in `_config.euler.yml` and theme files under `themes/euler/`.

## Build, Test, and Development Commands

- `npm install`: install Hexo and theme/plugin dependencies from `package-lock.json`.
- `npm run server`: start the local Hexo preview server.
- `npm run build`: force-generate the static site into `public/` and validate every rendered formula.
- `npm run check:math`: validate formula markup and local KaTeX assets in the existing `public/` output.
- `npm run clean`: remove generated Hexo cache and output before a fresh build.
- `npm run deploy`: deploy the generated site using the git deploy target in `_config.yml`.

There is no root test script. Use `npm run build` as the primary validation before submitting changes.

## Coding Style & Naming Conventions

Write Markdown posts with YAML front matter compatible with Hexo. Prefer descriptive post filenames in `source/_posts/`; existing posts use Chinese titles and hyphenated English terms when helpful, such as `Topic-Name.md`. Keep YAML files indented with two spaces. For theme edits, follow the existing Pug, Stylus, and JavaScript style in nearby files instead of reformatting whole files.

Write inline math as `$...$` without spaces immediately inside the delimiters. Put display math between `$$` delimiters on separate lines. Do not use `\(...\)` or `\[...\]`; Markdown consumes those backslashes before the KaTeX plugin can parse them. Put a literal dollar sign or literal TeX command in inline code so the math validator does not mistake it for an unrendered formula.

## Testing Guidelines

For content-only changes, run `npm run build` and check for broken front matter, renderer errors, and missing assets. For theme or configuration changes, also run `npm run server` and inspect affected pages in the browser. If adding diagrams, math, or custom tags, verify rendering because this site uses Mermaid and server-rendered KaTeX.

## Commit & Pull Request Guidelines

The current history only contains an initial commit, so use clear commit subjects such as `Add DSP post on OFDM` or `Update Butterfly navigation config`. Keep commits focused: separate content updates from theme/config changes when possible. Pull requests should include a short summary, affected paths, build result (`npm run build`), and screenshots for visible theme or layout changes.

## Security & Configuration Tips

Do not commit secrets, deployment keys, local environment files, or generated credentials. Review `_config.yml` carefully before changing deployment settings, permalink rules, or the production URL. Avoid committing generated `public/` output unless a deployment workflow explicitly requires it.
