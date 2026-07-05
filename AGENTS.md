# Repository Guidelines

## Project Structure & Module Organization

This repository is a Hexo 7 blog. Site settings live in `_config.yml`; npm dependencies and scripts are in `package.json`. Blog content is stored in `source/_posts/` as Markdown. Supporting pages such as tags, categories, links, and charts live under `source/`. Post templates are in `scaffolds/`. The active theme is Butterfly, with local theme configuration and overrides in `themes/butterfly/`; layouts are Pug files under `themes/butterfly/layout/`, styles under `themes/butterfly/source/css/`, and scripts under `themes/butterfly/source/js/`.

## Build, Test, and Development Commands

- `npm install`: install Hexo and theme/plugin dependencies from `package-lock.json`.
- `npm run server`: start the local Hexo preview server.
- `npm run build`: generate the static site into `public/`.
- `npm run clean`: remove generated Hexo cache and output before a fresh build.
- `npm run deploy`: deploy the generated site using the git deploy target in `_config.yml`.

There is no root test script. Use `npm run build` as the primary validation before submitting changes.

## Coding Style & Naming Conventions

Write Markdown posts with YAML front matter compatible with Hexo. Prefer descriptive post filenames in `source/_posts/`; existing posts use Chinese titles and hyphenated English terms when helpful, such as `Topic-Name.md`. Keep YAML files indented with two spaces. For theme edits, follow the existing Pug, Stylus, and JavaScript style in nearby files instead of reformatting whole files.

## Testing Guidelines

For content-only changes, run `npm run build` and check for broken front matter, renderer errors, and missing assets. For theme or configuration changes, also run `npm run server` and inspect affected pages in the browser. If adding diagrams, math, or custom tags, verify rendering because this site uses Mermaid, MathJax/KaTeX-related renderers, and Butterfly tag plugins.

## Commit & Pull Request Guidelines

The current history only contains an initial commit, so use clear commit subjects such as `Add DSP post on OFDM` or `Update Butterfly navigation config`. Keep commits focused: separate content updates from theme/config changes when possible. Pull requests should include a short summary, affected paths, build result (`npm run build`), and screenshots for visible theme or layout changes.

## Security & Configuration Tips

Do not commit secrets, deployment keys, local environment files, or generated credentials. Review `_config.yml` carefully before changing deployment settings, permalink rules, or the production URL. Avoid committing generated `public/` output unless a deployment workflow explicitly requires it.
