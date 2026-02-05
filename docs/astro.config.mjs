import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://esh2n.github.io',
	base: '/dotfiles',
	integrations: [
		starlight({
			title: 'esh2n/dotfiles',
			head: [
				{
					tag: 'script',
					content: `document.addEventListener('DOMContentLoaded',function(){requestAnimationFrame(function(){document.querySelectorAll('.sidebar-content').forEach(function(e){e.classList.add('sidebar-ready')})})});`,
				},
			],
			defaultLocale: 'root',
			locales: {
				root: {
					label: '日本語',
					lang: 'ja',
				},
				en: {
					label: 'English',
				},
			},
			components: {
				LanguageSelect: './src/components/LanguageSelect.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
				Search: './src/components/Search.astro',
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/esh2n/dotfiles',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/esh2n/dotfiles/edit/main/docs/',
			},
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Overview',
					translations: { ja: 'Overview' },
					slug: 'index',
				},
				{
					label: 'Getting Started',
					translations: { ja: 'Getting Started' },
					items: [
						{
							label: 'Installation',
							translations: { ja: 'Install' },
							slug: 'getting-started/installation',
						},
						{
							label: 'Configuration',
							translations: { ja: '構成' },
							slug: 'getting-started/configuration',
						},
					],
				},
				{
					label: 'Terminal',
					translations: { ja: 'Terminal' },
					items: [
						{
							label: 'Keybindings',
							translations: { ja: 'Keybindings' },
							slug: 'terminal/keybindings',
						},
						{ label: 'Zellij', slug: 'terminal/zellij' },
						{ label: 'tmux', slug: 'terminal/tmux' },
						{ label: 'Ghostty', slug: 'terminal/ghostty' },
						{ label: 'WezTerm', slug: 'terminal/wezterm' },
					],
				},
				{
					label: 'Shell',
					translations: { ja: 'Shell' },
					items: [
						{
							label: 'CLI Tools',
							slug: 'shell/cli-tools',
						},
						{ label: 'Starship', slug: 'shell/starship' },
					],
				},
				{
					label: 'Git / VCS',
					items: [
						{
							label: 'Git Aliases',
							slug: 'shell/git-aliases',
						},
						{
							label: 'Git Config',
							slug: 'tools/git-config',
						},
						{
							label: 'Git Worktree (wtp)',
							slug: 'tools/git-worktree',
						},
						{ label: 'Jujutsu (jj)', slug: 'shell/jujutsu' },
					],
				},
				{
					label: 'Editor',
					translations: { ja: 'Editor' },
					items: [
						{ label: 'Neovim', slug: 'editor/neovim' },
						{ label: 'VSCode', slug: 'editor/vscode' },
					],
				},
				{
					label: 'Workspace',
					translations: { ja: 'Workspace' },
					items: [
						{ label: 'AeroSpace', slug: 'workspace/aerospace' },
						{ label: 'Sketchybar', slug: 'workspace/sketchybar' },
						{ label: 'Borders', slug: 'workspace/borders' },
						{
							label: 'Workspace CLI',
							slug: 'workspace/workspace-cli',
						},
					],
				},
				{
					label: 'Tools',
					translations: { ja: 'Tools' },
					items: [
						{
							label: 'Theme Switcher',
							translations: { ja: 'Theme Switcher' },
							slug: 'tools/theme-switcher',
						},
						{ label: 'direnv', slug: 'tools/direnv' },
						{
							label: 'Browser Extensions',
							slug: 'tools/browser-extensions',
						},
					],
				},
			],
		}),
	],
});
