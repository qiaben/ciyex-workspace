/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICiyexAuthService, CiyexAuthState } from './ciyexAuthService.js';

type AuthStep = 'email' | 'authenticate' | 'locked' | 'warning';

/**
 * Full-screen auth overlay that blocks the entire workbench until authenticated.
 * Implements the same two-step login flow as Ciyex EHR UI.
 */
export class CiyexAuthGate extends Disposable {

	private _overlay: HTMLDivElement | undefined;
	private _step: AuthStep = 'email';
	private _email = '';
	private _password = '';
	private _showPassword = false;
	private _loading = false;
	private _error = '';
	private _discoverResult: { exists: boolean; authMethods: string[]; orgName: string; idps: Array<{ alias: string; displayName: string; providerId: string }> } | null = null;
	private _countdown = 120;
	private _countdownInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly _parent: HTMLElement,
		private readonly _authService: ICiyexAuthService
	) {
		super();

		this._register(this._authService.onDidChangeAuthState(state => this._onAuthStateChanged(state)));
		this._register(this._authService.onSessionWarning(countdown => this._onSessionWarning(countdown)));

		// Show overlay if not authenticated
		if (this._authService.state !== CiyexAuthState.Authenticated) {
			this._show();
		}
	}

	private _onAuthStateChanged(state: CiyexAuthState): void {
		switch (state) {
			case CiyexAuthState.Authenticated:
				this._hide();
				break;
			case CiyexAuthState.NotAuthenticated:
				this._step = 'email';
				this._email = '';
				this._password = '';
				this._error = '';
				this._discoverResult = null;
				this._show();
				break;
			case CiyexAuthState.Locked:
				this._step = 'locked';
				this._password = '';
				this._error = '';
				this._email = this._authService.userEmail || '';
				this._show();
				break;
			case CiyexAuthState.Warning:
				// Warning is handled by onSessionWarning
				break;
		}
	}

	private _onSessionWarning(countdown: number): void {
		this._step = 'warning';
		this._countdown = countdown;
		this._show();
		this._startCountdown();
	}

	private _startCountdown(): void {
		this._clearCountdown();
		this._countdownInterval = setInterval(() => {
			this._countdown--;
			if (this._countdown <= 0) {
				this._clearCountdown();
				this._authService.signOut();
			} else {
				this._render();
			}
		}, 1000);
	}

	private _clearCountdown(): void {
		if (this._countdownInterval) {
			clearInterval(this._countdownInterval);
			this._countdownInterval = null;
		}
	}

	private _show(): void {
		if (!this._overlay) {
			this._overlay = document.createElement('div');
			this._overlay.id = 'ciyex-auth-gate';
			this._parent.appendChild(this._overlay);
		}
		this._overlay.style.display = '';
		this._render();
	}

	private _hide(): void {
		this._clearCountdown();
		if (this._overlay) {
			this._overlay.style.display = 'none';
		}
	}

	private _render(): void {
		if (!this._overlay) {
			return;
		}

		const isDark = document.body.classList.contains('vs-dark') || document.body.classList.contains('hc-black') ||
			window.matchMedia('(prefers-color-scheme: dark)').matches;

		const bg = isDark ? '#1e1e2e' : '#f0f2f5';
		const cardBg = isDark ? '#2d2d3f' : '#ffffff';
		const textPrimary = isDark ? '#e0e0e0' : '#1a1a2e';
		const textSecondary = isDark ? '#a0a0b0' : '#6b7280';
		const borderColor = isDark ? '#3d3d4f' : '#e5e7eb';
		const inputBg = isDark ? '#1e1e2e' : '#f9fafb';
		const brandColor = '#465FFF';
		const brandHover = '#3449e3';
		const errorBg = isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2';
		const errorText = isDark ? '#fca5a5' : '#dc2626';
		const errorBorder = isDark ? '#7f1d1d' : '#fecaca';
		const warningColor = '#f59e0b';

		let content = '';

		if (this._step === 'warning') {
			content = this._renderWarning(cardBg, textPrimary, textSecondary, borderColor, brandColor, brandHover, warningColor);
		} else if (this._step === 'locked') {
			content = this._renderLocked(cardBg, textPrimary, textSecondary, borderColor, brandColor, brandHover, inputBg, errorBg, errorText, errorBorder);
		} else if (this._step === 'authenticate') {
			content = this._renderAuthenticate(cardBg, textPrimary, textSecondary, borderColor, brandColor, brandHover, inputBg, errorBg, errorText, errorBorder);
		} else {
			content = this._renderEmailStep(cardBg, textPrimary, textSecondary, borderColor, brandColor, brandHover, inputBg, errorBg, errorText, errorBorder);
		}

		this._overlay.innerHTML = `
			<style>
				#ciyex-auth-gate {
					position: fixed;
					inset: 0;
					z-index: 99999;
					display: flex;
					align-items: center;
					justify-content: center;
					background: ${bg};
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
					-webkit-app-region: drag;
				}
				#ciyex-auth-gate * {
					-webkit-app-region: no-drag;
				}
				#ciyex-auth-gate input {
					outline: none;
					transition: border-color 0.15s, box-shadow 0.15s;
				}
				#ciyex-auth-gate input:focus {
					border-color: ${brandColor};
					box-shadow: 0 0 0 3px rgba(70, 95, 255, 0.15);
				}
				#ciyex-auth-gate button {
					cursor: pointer;
					transition: background-color 0.15s, opacity 0.15s;
				}
				#ciyex-auth-gate button:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}
				@keyframes ciyex-spin {
					to { transform: rotate(360deg); }
				}
				.ciyex-spinner {
					animation: ciyex-spin 1s linear infinite;
				}
			</style>
			${content}
		`;

		this._attachListeners();
	}

	private _renderEmailStep(cardBg: string, textPrimary: string, textSecondary: string, borderColor: string, brandColor: string, brandHover: string, inputBg: string, errorBg: string, errorText: string, errorBorder: string): string {
		return `
			<div style="width: 100%; max-width: 400px; padding: 16px;">
				<div style="text-align: center; margin-bottom: 32px;">
					${this._logoSvg(48)}
					<h1 style="font-size: 22px; font-weight: 700; color: ${textPrimary}; margin: 12px 0 4px;">Ciyex Workspace</h1>
					<p style="font-size: 13px; color: ${textSecondary}; margin: 0;">Sign in to continue</p>
				</div>
				<div style="background: ${cardBg}; border: 1px solid ${borderColor}; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
					<div style="margin-bottom: 20px;">
						<label style="display: block; font-size: 13px; font-weight: 500; color: ${textPrimary}; margin-bottom: 6px;">Email</label>
						<input id="ciyex-email" type="email" placeholder="you@example.com" value="${this._escapeHtml(this._email)}"
							style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid ${borderColor}; background: ${inputBg}; color: ${textPrimary}; font-size: 14px; box-sizing: border-box;"
							${this._loading ? 'disabled' : ''} autocomplete="email" autofocus />
					</div>
					${this._error ? `
						<div style="background: ${errorBg}; border: 1px solid ${errorBorder}; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: ${errorText};">
							${this._escapeHtml(this._error)}
						</div>
					` : ''}
					<button id="ciyex-discover-btn" style="width: 100%; padding: 10px; border-radius: 8px; border: none; background: ${brandColor}; color: white; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;"
						${this._loading || !this._email.trim() ? 'disabled' : ''}>
						${this._loading ? `<svg class="ciyex-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="white" stroke-width="4"/><path opacity="0.75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Checking...` : 'Continue'}
					</button>
				</div>
				<div style="text-align: center; margin-top: 20px;">
					<button id="ciyex-settings-btn" style="background: none; border: none; color: ${textSecondary}; font-size: 12px; text-decoration: underline; padding: 4px;">
						Server Settings
					</button>
				</div>
			</div>
		`;
	}

	private _renderAuthenticate(cardBg: string, textPrimary: string, textSecondary: string, borderColor: string, brandColor: string, brandHover: string, inputBg: string, errorBg: string, errorText: string, errorBorder: string): string {
		return `
			<div style="width: 100%; max-width: 400px; padding: 16px;">
				<div style="text-align: center; margin-bottom: 32px;">
					${this._logoSvg(48)}
					<h1 style="font-size: 22px; font-weight: 700; color: ${textPrimary}; margin: 12px 0 4px;">Welcome back</h1>
					<p style="font-size: 13px; color: ${textSecondary}; margin: 0;">${this._escapeHtml(this._email)}</p>
					${this._discoverResult?.orgName ? `<p style="font-size: 12px; color: ${textSecondary}; margin: 2px 0 0;">${this._escapeHtml(this._discoverResult.orgName)}</p>` : ''}
				</div>
				<div style="background: ${cardBg}; border: 1px solid ${borderColor}; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
					<button id="ciyex-back-btn" style="display: flex; align-items: center; gap: 4px; background: none; border: none; color: ${textSecondary}; font-size: 13px; padding: 0; margin-bottom: 16px;">
						<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
						Back
					</button>
					<div style="margin-bottom: 20px;">
						<label style="display: block; font-size: 13px; font-weight: 500; color: ${textPrimary}; margin-bottom: 6px;">Password</label>
						<div style="position: relative;">
							<input id="ciyex-password" type="${this._showPassword ? 'text' : 'password'}" placeholder="Enter your password" value="${this._escapeHtml(this._password)}"
								style="width: 100%; padding: 10px 40px 10px 12px; border-radius: 8px; border: 1px solid ${borderColor}; background: ${inputBg}; color: ${textPrimary}; font-size: 14px; box-sizing: border-box;"
								${this._loading ? 'disabled' : ''} autocomplete="current-password" autofocus />
							<button id="ciyex-toggle-pw" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: ${textSecondary}; padding: 2px;">
								${this._showPassword
				? '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>'
				: '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'}
							</button>
						</div>
					</div>
					${this._error ? `
						<div style="background: ${errorBg}; border: 1px solid ${errorBorder}; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: ${errorText};">
							${this._escapeHtml(this._error)}
						</div>
					` : ''}
					<button id="ciyex-login-btn" style="width: 100%; padding: 10px; border-radius: 8px; border: none; background: ${brandColor}; color: white; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;"
						${this._loading || !this._password ? 'disabled' : ''}>
						${this._loading ? `<svg class="ciyex-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="white" stroke-width="4"/><path opacity="0.75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Signing in...` : 'Sign In'}
					</button>
					${this._renderIdpButtons(borderColor, textPrimary)}
				</div>
			</div>
		`;
	}

	private _renderLocked(cardBg: string, textPrimary: string, textSecondary: string, borderColor: string, brandColor: string, brandHover: string, inputBg: string, errorBg: string, errorText: string, errorBorder: string): string {
		return `
			<div style="width: 100%; max-width: 400px; padding: 16px;">
				<div style="text-align: center; margin-bottom: 32px;">
					${this._lockIconSvg(48)}
					<h1 style="font-size: 22px; font-weight: 700; color: ${textPrimary}; margin: 12px 0 4px;">Session Locked</h1>
					<p style="font-size: 13px; color: ${textSecondary}; margin: 0;">Your session has expired. Sign in again to continue.</p>
					${this._email ? `<p style="font-size: 13px; color: ${textPrimary}; margin: 8px 0 0; font-weight: 500;">${this._escapeHtml(this._email)}</p>` : ''}
				</div>
				<div style="background: ${cardBg}; border: 1px solid ${borderColor}; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
					<div style="margin-bottom: 20px;">
						<label style="display: block; font-size: 13px; font-weight: 500; color: ${textPrimary}; margin-bottom: 6px;">Password</label>
						<div style="position: relative;">
							<input id="ciyex-password" type="${this._showPassword ? 'text' : 'password'}" placeholder="Enter your password" value="${this._escapeHtml(this._password)}"
								style="width: 100%; padding: 10px 40px 10px 12px; border-radius: 8px; border: 1px solid ${borderColor}; background: ${inputBg}; color: ${textPrimary}; font-size: 14px; box-sizing: border-box;"
								${this._loading ? 'disabled' : ''} autocomplete="current-password" autofocus />
							<button id="ciyex-toggle-pw" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: ${textSecondary}; padding: 2px;">
								${this._showPassword
				? '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>'
				: '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'}
							</button>
						</div>
					</div>
					${this._error ? `
						<div style="background: ${errorBg}; border: 1px solid ${errorBorder}; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: ${errorText};">
							${this._escapeHtml(this._error)}
						</div>
					` : ''}
					<button id="ciyex-login-btn" style="width: 100%; padding: 10px; border-radius: 8px; border: none; background: ${brandColor}; color: white; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px;"
						${this._loading || !this._password ? 'disabled' : ''}>
						${this._loading ? `<svg class="ciyex-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="white" stroke-width="4"/><path opacity="0.75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Signing in...` : 'Unlock'}
					</button>
					<button id="ciyex-switch-account-btn" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid ${borderColor}; background: none; color: ${textSecondary}; font-size: 13px;">
						Sign in with a different account
					</button>
				</div>
			</div>
		`;
	}

	private _renderWarning(cardBg: string, textPrimary: string, textSecondary: string, borderColor: string, brandColor: string, brandHover: string, warningColor: string): string {
		const mins = Math.floor(this._countdown / 60);
		const secs = this._countdown % 60;
		const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

		return `
			<div style="width: 100%; max-width: 400px; padding: 16px;">
				<div style="background: ${cardBg}; border: 1px solid ${borderColor}; border-radius: 12px; padding: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
					<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
						<div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); display: flex; align-items: center; justify-content: center;">
							<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="${warningColor}">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
							</svg>
						</div>
						<h3 style="font-size: 18px; font-weight: 600; color: ${textPrimary}; margin: 0;">Session Expiring</h3>
					</div>
					<p style="font-size: 14px; color: ${textSecondary}; margin: 0 0 4px;">
						Your session will expire in <span style="font-weight: 700; color: ${warningColor};">${timeStr}</span>
					</p>
					<p style="font-size: 13px; color: ${textSecondary}; margin: 0 0 20px;">
						Click below to stay logged in, or you will be signed out automatically.
					</p>
					<div style="display: flex; gap: 10px;">
						<button id="ciyex-stay-btn" style="flex: 1; padding: 10px; border-radius: 8px; border: none; background: ${brandColor}; color: white; font-size: 14px; font-weight: 500;">
							Stay Logged In
						</button>
						<button id="ciyex-signout-btn" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid ${borderColor}; background: none; color: ${textPrimary}; font-size: 14px; font-weight: 500;">
							Sign Out
						</button>
					</div>
				</div>
			</div>
		`;
	}

	private _renderIdpButtons(borderColor: string, textPrimary: string): string {
		if (!this._discoverResult?.idps?.length) {
			return '';
		}

		const buttons = this._discoverResult.idps.map((idp, i) => {
			let icon = '';
			if (idp.alias.toLowerCase().includes('google')) {
				icon = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
			} else if (idp.alias.toLowerCase().includes('microsoft')) {
				icon = '<svg width="18" height="18" viewBox="0 0 24 24"><rect fill="#F25022" x="1" y="1" width="10" height="10"/><rect fill="#7FBA00" x="13" y="1" width="10" height="10"/><rect fill="#00A4EF" x="1" y="13" width="10" height="10"/><rect fill="#FFB900" x="13" y="13" width="10" height="10"/></svg>';
			}

			return `
				<button class="ciyex-idp-btn" data-idp-index="${i}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid ${borderColor}; background: none; color: ${textPrimary}; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
					${icon} Continue with ${this._escapeHtml(idp.displayName || idp.alias)}
				</button>
			`;
		}).join('');

		return `
			<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${borderColor};">
				<p style="text-align: center; font-size: 12px; color: ${textPrimary}; margin: 0 0 12px; opacity: 0.5;">or</p>
				<div style="display: flex; flex-direction: column; gap: 8px;">
					${buttons}
				</div>
			</div>
		`;
	}

	private _attachListeners(): void {
		// Email input
		const emailInput = this._overlay?.querySelector('#ciyex-email') as HTMLInputElement | null;
		if (emailInput) {
			emailInput.addEventListener('input', () => { this._email = emailInput.value; });
			emailInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					this._handleDiscover();
				}
			});
			setTimeout(() => emailInput.focus(), 50);
		}

		// Password input
		const passwordInput = this._overlay?.querySelector('#ciyex-password') as HTMLInputElement | null;
		if (passwordInput) {
			passwordInput.addEventListener('input', () => { this._password = passwordInput.value; });
			passwordInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					this._handleLogin();
				}
			});
			setTimeout(() => passwordInput.focus(), 50);
		}

		// Toggle password visibility
		this._overlay?.querySelector('#ciyex-toggle-pw')?.addEventListener('click', () => {
			this._showPassword = !this._showPassword;
			this._render();
		});

		// Discover button
		this._overlay?.querySelector('#ciyex-discover-btn')?.addEventListener('click', () => this._handleDiscover());

		// Login button
		this._overlay?.querySelector('#ciyex-login-btn')?.addEventListener('click', () => this._handleLogin());

		// Back button
		this._overlay?.querySelector('#ciyex-back-btn')?.addEventListener('click', () => {
			this._step = 'email';
			this._password = '';
			this._error = '';
			this._discoverResult = null;
			this._render();
		});

		// Switch account button (from locked screen)
		this._overlay?.querySelector('#ciyex-switch-account-btn')?.addEventListener('click', () => {
			this._authService.signOut();
		});

		// Warning buttons
		this._overlay?.querySelector('#ciyex-stay-btn')?.addEventListener('click', () => {
			this._clearCountdown();
			this._authService.dismissWarning();
		});
		this._overlay?.querySelector('#ciyex-signout-btn')?.addEventListener('click', () => {
			this._clearCountdown();
			this._authService.signOut();
		});

		// Server settings button
		this._overlay?.querySelector('#ciyex-settings-btn')?.addEventListener('click', () => {
			const current = this._authService.apiUrl;
			const newUrl = prompt('Enter Ciyex API Server URL:', current);
			if (newUrl && newUrl.trim()) {
				localStorage.setItem('ciyex_api_url', newUrl.trim().replace(/\/$/, ''));
			}
		});
	}

	private async _handleDiscover(): Promise<void> {
		if (!this._email.trim() || this._loading) {
			return;
		}

		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.discover(this._email);
		this._loading = false;

		if (result.error) {
			this._error = result.error;
			this._render();
			return;
		}

		if (!result.exists) {
			this._error = 'No account found with this email. Contact your administrator.';
			this._render();
			return;
		}

		this._discoverResult = result;
		this._step = 'authenticate';
		this._render();
	}

	private async _handleLogin(): Promise<void> {
		if (!this._email.trim() || !this._password || this._loading) {
			return;
		}

		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.login(this._email, this._password);
		this._loading = false;

		if (!result.success) {
			this._error = result.error || 'Login failed';
			this._render();
		}
		// On success, the auth state change listener will hide the overlay
	}

	private _logoSvg(size: number): string {
		return `
			<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin: 0 auto; display: block;">
				<path d="M0 8.42105C0 3.77023 3.77023 0 8.42105 0H23.5789C28.2298 0 32 3.77023 32 8.42105V23.5789C32 28.2298 28.2298 32 23.5789 32H8.42105C3.77023 32 0 28.2298 0 23.5789V8.42105Z" fill="#465FFF"/>
				<path d="M8.42383 8.42152C8.42383 7.49135 9.17787 6.7373 10.108 6.7373C11.0382 6.7373 11.7922 7.49135 11.7922 8.42152V23.5794C11.7922 24.5096 11.0382 25.2636 10.108 25.2636C9.17787 25.2636 8.42383 24.5096 8.42383 23.5794V8.42152Z" fill="white"/>
				<path d="M14.7422 15.1569C14.7422 14.2267 15.4962 13.4727 16.4264 13.4727C17.3566 13.4727 18.1106 14.2267 18.1106 15.1569V23.5779C18.1106 24.5081 17.3566 25.2621 16.4264 25.2621C15.4962 25.2621 14.7422 24.5081 14.7422 23.5779V15.1569Z" fill="white" fill-opacity="0.9"/>
				<path d="M21.0547 10.9459C21.0547 10.0158 21.8087 9.26172 22.7389 9.26172C23.6691 9.26172 24.4231 10.0158 24.4231 10.9459V23.5775C24.4231 24.5077 23.6691 25.2617 22.7389 25.2617C21.8087 25.2617 21.0547 24.5077 21.0547 23.5775V10.9459Z" fill="white" fill-opacity="0.7"/>
			</svg>
		`;
	}

	private _lockIconSvg(size: number): string {
		return `
			<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#465FFF" stroke-width="1.5" style="margin: 0 auto; display: block;">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0110 0v4"/>
				<circle cx="12" cy="16" r="1"/>
			</svg>
		`;
	}

	private _escapeHtml(str: string): string {
		const div = document.createElement('div');
		div.textContent = str;
		return div.innerHTML;
	}

	override dispose(): void {
		this._clearCountdown();
		if (this._overlay) {
			this._overlay.remove();
			this._overlay = undefined;
		}
		super.dispose();
	}
}
